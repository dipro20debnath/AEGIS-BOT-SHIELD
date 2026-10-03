"""
Scores browser telemetry and issues tokens.

Flow for POST /aegis/telemetry:
  SDK features (contracts/features.json) + server-side session and network
  features -> rule signals + ML probability -> noisy-OR risk score ->
  verdict -> signed token carrying the score, bound to the session and
  user agent.

`on_record` receives one record per scored telemetry submission (for
research logging). Records contain the feature vector, scores and verdict,
a salted hash of the session id, and no IP address or user agent.
"""
import hashlib
import hmac
import json
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from pydantic import ValidationError

from .detector import RequestAnalyzer, Signal, behavior_signals, noisy_or
from .feeds import FEED_SEVERITY, IPReputation
from .ip_intel import classify_ip
from .ml import MLScorer
from .models import AegisConfig, TelemetryPayload
from .sessions import Session, SessionTracker
from .verifier import generate_token

CONTRACT_KEYS: Dict[str, List[str]] = {
    "mouse": [
        "mouse_avg_velocity", "mouse_velocity_std", "mouse_max_velocity", "mouse_avg_acceleration",
        "mouse_acceleration_std", "mouse_avg_jerk", "mouse_straightness_index", "mouse_curvature_score",
        "mouse_click_precision", "mouse_micro_tremor_freq", "mouse_fitts_law_r2", "mouse_direction_changes",
        "mouse_pause_count", "mouse_avg_pause_duration", "mouse_event_count",
    ],
    "keyboard": [
        "kb_avg_dwell_time", "kb_dwell_time_std", "kb_avg_flight_time", "kb_flight_time_std", "kb_typing_speed",
        "kb_paste_count", "kb_correction_ratio", "kb_cadence_entropy", "kb_total_events", "kb_total_duration",
    ],
    "scroll": [
        "scroll_avg_velocity", "scroll_direction_changes", "scroll_max_depth", "scroll_event_count",
        "scroll_momentum_ratio",
    ],
    "touch": [
        "touch_avg_pressure", "touch_avg_radius", "touch_swipe_velocity", "touch_tap_count",
        "touch_multi_touch_ratio",
    ],
    "fingerprint": ["has_webgl", "has_canvas", "plugin_count", "is_headless", "headless_confidence"],
}


class TelemetryError(ValueError):
    """Invalid telemetry; carries the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def user_agent_hash(user_agent: str) -> str:
    return hashlib.sha256(user_agent.encode("utf-8")).hexdigest()[:16]


def decide(score: float, config: AegisConfig) -> str:
    if config.mode == "monitor":
        return "monitor" if score >= config.challenge_threshold else "allow"
    if score >= config.block_threshold:
        return "block"
    if score >= config.challenge_threshold:
        return "challenge"
    return "allow"


class TelemetryService:
    def __init__(self, config: AegisConfig, sessions: SessionTracker, scorer: MLScorer,
                 analyzer: Optional[RequestAnalyzer] = None,
                 on_record: Optional[Callable[[Dict[str, Any]], None]] = None,
                 reputation: Optional[IPReputation] = None):
        self.config = config
        self.reputation = reputation
        self.sessions = sessions
        self.scorer = scorer
        self.analyzer = analyzer or RequestAnalyzer(config.verify_search_engines)
        self.on_record = on_record

    def parse(self, body: bytes) -> TelemetryPayload:
        if len(body) > self.config.max_telemetry_bytes:
            raise TelemetryError("telemetry too large", 413)
        try:
            payload = TelemetryPayload.model_validate(json.loads(body))
        except (ValueError, ValidationError) as exc:
            raise TelemetryError(f"invalid telemetry: {exc}".splitlines()[0]) from exc
        if not hmac.compare_digest(payload.siteKey, self.config.site_key):
            raise TelemetryError("unknown site key", 403)
        return payload

    def feature_vector(self, payload: TelemetryPayload, ip: str, session: Session) -> Dict[str, Dict[str, float]]:
        """The full 50-feature input of the ML extractor; unknown SDK keys are dropped."""
        sent = payload.features.model_dump()
        features: Dict[str, Dict[str, float]] = {}
        for category, keys in CONTRACT_KEYS.items():
            group = sent.get(category, {})
            features[category] = {k: float(group.get(k, 0.0) or 0.0) for k in keys}
        features["session"] = self.sessions.features(session)
        features["network"] = classify_ip(ip, self.reputation)
        return features

    def process(self, body: bytes, ip: str, headers: Dict[str, str], session: Session) -> Tuple[Dict[str, Any], List[Signal]]:
        payload = self.parse(body)
        features = self.feature_vector(payload, ip, session)

        signals: List[Signal] = list(self.analyzer.signals(ip, headers, "POST", self.config.telemetry_path))
        signals += behavior_signals(features, payload.headlessChecks)
        # Spoofed-fingerprint evidence: only when several checks agree (score >= 0.5)
        if payload.antiDetect and payload.antiDetect.score >= 0.5:
            signals.append(("anti_detect", round(80 * payload.antiDetect.score, 1)))
        network = features["network"]
        if network["is_tor"]:
            signals.append(("tor_exit", 70))
        if network["is_datacenter"]:
            signals.append(("datacenter_ip", 45))
        if self.reputation is not None:
            signals += [(f"threat_list:{name}", FEED_SEVERITY[name])
                        for name in self.reputation.lookup(ip)["lists"]]
        rule_score = noisy_or(s for _, s in signals)

        ml_probability = self.scorer.score(features)
        scores = [rule_score]
        if ml_probability is not None:
            # Rescale so the model's own decision threshold maps to the challenge threshold
            threshold = min(max(self.scorer.threshold, 1e-6), 1 - 1e-6)
            if ml_probability < threshold:
                ml_score = ml_probability / threshold * self.config.challenge_threshold
            else:
                ml_score = self.config.challenge_threshold + (ml_probability - threshold) / (1 - threshold) \
                    * (100 - self.config.challenge_threshold)
            scores.append(ml_score)
            signals.append(("ml_model", round(ml_score, 1)))
        score = round(noisy_or(scores), 1)
        verdict = decide(score, self.config)
        self.sessions.record_risk(session, score)
        session.telemetry_score = score

        now = int(time.time())
        ua = next((v for k, v in headers.items() if k.lower() == "user-agent"), "")
        token = generate_token({
            "sid": session.id,
            "score": score,
            "verdict": verdict,
            "uah": user_agent_hash(ua),
            "exp": now + self.config.token_ttl,
        }, self.config.secret_key)

        if self.on_record:
            self.on_record({
                "timestamp": now,
                "session": hashlib.sha256((self.config.secret_key + session.id).encode()).hexdigest()[:16],
                "stream": payload.streamId,
                "features": features,
                "headless_checks": payload.headlessChecks,
                "anti_detect": payload.antiDetect.model_dump() if payload.antiDetect else None,
                "rule_score": round(rule_score, 1),
                "ml_probability": ml_probability,
                "score": score,
                "verdict": verdict,
                "signals": signals,
            })

        return {"token": token, "expiresIn": self.config.token_ttl, "verdict": verdict, "score": score}, signals
