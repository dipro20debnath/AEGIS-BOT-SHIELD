"""
Synthetic Data Generator for Bot Detection Training

Generates realistic training data since real bot data is hard to collect.
Used for initial model training before real data collection.

Generates two classes:
1. Human-like behavioral data (natural, variable, imperfect)
2. Bot-like behavioral data (mechanical, precise, uniform)

Every sample uses exactly the raw keys that FeatureExtractor reads
(see FeatureExtractor.FEATURE_CATEGORIES), so all 50 features are populated.

Realism choices (so the task is not trivially separable):
- Humans are split into desktop (mouse, no touch) and mobile (touch, no mouse)
- Some humans never type, bounce quickly, or browse through a VPN/corporate cloud
- Headless bots are not always detected as headless (stealth patches)
- Sophisticated bots replay human-like mouse/keyboard dynamics with small shifts
  and often route through residential proxies
- Replay bots inject recorded real-human traces, so their mouse/keyboard/scroll/
  touch features are drawn from the human distribution; only session pacing,
  network origin, fingerprint leaks and device inconsistencies give them away

Based on published research:
- Balabit Mouse Dynamics Dataset patterns
- Academic papers on keystroke dynamics
- Known bot automation characteristics

Conventions: reputation scores are risk scores in [0, 1] (0 = clean, 1 = bad);
boolean signals are encoded as 0.0 / 1.0.
"""
import numpy as np
from typing import List, Dict, Tuple, Optional


BOT_TYPES = ['simple_script', 'headless_browser', 'sophisticated_bot', 'crawler', 'replay_bot']


class SyntheticDataGenerator:
    """Generates synthetic human and bot behavioral data."""

    def __init__(self, random_state: int = 42):
        self.rng = np.random.RandomState(random_state)

    def generate(self, n_human: int = 1000, n_bot: int = 1000) -> Tuple[List[Dict], np.ndarray]:
        """Generate balanced dataset of human and bot samples."""
        data = []
        labels = []

        for _ in range(n_human):
            data.append(self._generate_human())
            labels.append(0)

        for _ in range(n_bot):
            data.append(self._generate_bot())
            labels.append(1)

        return data, np.array(labels)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _pos(self, x: float) -> float:
        return float(max(x, 0.0))

    def _clip01(self, x: float) -> float:
        return float(min(max(x, 0.0), 1.0))

    def _flag(self, p: float) -> float:
        return 1.0 if self.rng.rand() < p else 0.0

    def _count(self, mean: float, std: float) -> float:
        return float(max(int(round(self.rng.normal(mean, std))), 0))

    # ------------------------------------------------------------------
    # Sample assembly
    # ------------------------------------------------------------------

    def _random_device(self) -> str:
        return 'mobile' if self.rng.rand() < 0.3 else 'desktop'

    def _human_behavior(self, device: str, bounced: bool) -> Dict:
        """Mouse/keyboard/scroll/touch of one real-looking human session."""
        typed = self.rng.rand() < 0.8
        return {
            'mouse': self._human_mouse(bounced) if device == 'desktop' else self._empty_mouse(),
            'keyboard': self._human_keyboard() if typed and not bounced else self._empty_keyboard(),
            'scroll': self._human_scroll(device, bounced),
            'touch': self._human_touch(bounced) if device == 'mobile' else self._empty_touch(),
        }

    def _generate_human(self) -> Dict:
        """Generate human-like behavioral data."""
        device = self._random_device()
        bounced = self.rng.rand() < 0.1  # left after a few seconds
        sample = self._human_behavior(device, bounced)
        sample.update({
            'session': self._human_session(bounced),
            'network': self._human_network(),
            'fingerprint': self._human_fingerprint(device),
        })
        return sample

    def _generate_bot(self, bot_type: Optional[str] = None) -> Dict:
        """Generate bot-like behavioral data with variations."""
        if bot_type is None:
            bot_type = self.rng.choice(BOT_TYPES)
        if bot_type == 'replay_bot':
            return self._generate_replay_bot()

        return {
            'mouse': self._bot_mouse(bot_type),
            'keyboard': self._bot_keyboard(bot_type),
            'scroll': self._bot_scroll(bot_type),
            'touch': self._bot_touch(bot_type),
            'session': self._bot_session(bot_type),
            'network': self._bot_network(bot_type),
            'fingerprint': self._bot_fingerprint(bot_type),
        }

    def _generate_replay_bot(self) -> Dict:
        """Bot that replays a recorded human session through a stealth browser.

        Behavioral features come straight from the human generator. The bot
        presents its own browser profile, which matches the recorded trace's
        device most of the time but not always (e.g. a phone touch trace
        replayed inside a desktop browser profile).
        """
        trace_device = self._random_device()
        sample = self._human_behavior(trace_device, bounced=False)
        profile_device = trace_device
        if self.rng.rand() < 0.25:
            profile_device = 'desktop' if trace_device == 'mobile' else 'mobile'
        sample.update({
            'session': self._bot_session('replay_bot'),
            'network': self._bot_network('replay_bot'),
            'fingerprint': self._bot_fingerprint('replay_bot', profile_device),
        })
        return sample

    # ------------------------------------------------------------------
    # Mouse (15 features)
    # ------------------------------------------------------------------

    def _empty_mouse(self) -> Dict:
        return {k: 0.0 for k in (
            'mouse_avg_velocity', 'mouse_velocity_std', 'mouse_max_velocity',
            'mouse_avg_acceleration', 'mouse_acceleration_std', 'mouse_avg_jerk',
            'mouse_straightness_index', 'mouse_curvature_score', 'mouse_click_precision',
            'mouse_micro_tremor_freq', 'mouse_fitts_law_r2', 'mouse_direction_changes',
            'mouse_pause_count', 'mouse_avg_pause_duration', 'mouse_event_count')}

    def _mouse(self, velocity: float, velocity_cv: float, straightness: float,
               curvature: float, precision: float, tremor: float, fitts_r2: float,
               direction_changes: float, pause_count: float, pause_ms: float,
               event_count: float) -> Dict:
        velocity = self._pos(velocity)
        velocity_std = self._pos(velocity * velocity_cv)
        acceleration = self._pos(velocity * self.rng.uniform(2.0, 4.0))
        return {
            'mouse_avg_velocity': velocity,
            'mouse_velocity_std': velocity_std,
            'mouse_max_velocity': velocity + velocity_std * self.rng.uniform(1.5, 3.0),
            'mouse_avg_acceleration': acceleration,
            'mouse_acceleration_std': self._pos(acceleration * velocity_cv * self.rng.uniform(0.8, 1.4)),
            'mouse_avg_jerk': self._pos(acceleration * velocity_cv * self.rng.uniform(5.0, 15.0)),
            'mouse_straightness_index': self._clip01(straightness),
            'mouse_curvature_score': self._clip01(curvature),
            'mouse_click_precision': self._clip01(precision),
            'mouse_micro_tremor_freq': self._pos(tremor),
            'mouse_fitts_law_r2': self._clip01(fitts_r2),
            'mouse_direction_changes': self._pos(direction_changes),
            'mouse_pause_count': self._pos(pause_count),
            'mouse_avg_pause_duration': self._pos(pause_ms),
            'mouse_event_count': self._pos(event_count),
        }

    def _human_mouse(self, bounced: bool) -> Dict:
        events = self._count(25, 10) if bounced else self._count(180, 70)
        return self._mouse(
            velocity=self.rng.lognormal(np.log(400), 0.35),      # ~200-800 px/s
            velocity_cv=self.rng.uniform(0.35, 0.8),
            straightness=self.rng.beta(6, 2.5),                    # mostly 0.55-0.9
            curvature=self.rng.beta(3, 3),
            precision=self.rng.beta(5, 3),
            tremor=self.rng.normal(10, 1.5),                       # 8-12 Hz physiological tremor
            fitts_r2=self.rng.beta(8, 2),                          # ~0.7-0.95
            direction_changes=events * self.rng.uniform(0.08, 0.2),
            pause_count=events * self.rng.uniform(0.02, 0.08),
            pause_ms=self.rng.lognormal(np.log(600), 0.5),
            event_count=events,
        )

    def _bot_mouse(self, bot_type: str) -> Dict:
        if bot_type in ('simple_script', 'crawler'):
            return self._empty_mouse()  # no JavaScript runs, so no mouse events
        if bot_type == 'headless_browser':
            if self.rng.rand() < 0.4:
                return self._empty_mouse()  # clicks via element.click(), no movement
            events = self._count(15, 6)
            return self._mouse(
                velocity=self.rng.uniform(800, 3000),
                velocity_cv=self.rng.uniform(0.0, 0.1),
                straightness=self.rng.uniform(0.95, 1.0),
                curvature=self.rng.uniform(0.0, 0.05),
                precision=self.rng.uniform(0.95, 1.0),             # clicks element centre
                tremor=0.0,
                fitts_r2=self.rng.uniform(0.0, 0.3),
                direction_changes=self.rng.poisson(1),
                pause_count=self.rng.poisson(0.5),
                pause_ms=self.rng.uniform(0, 100),
                event_count=events,
            )
        # sophisticated_bot: Bezier-curve cursor libraries with injected noise
        events = self._count(120, 50)
        return self._mouse(
            velocity=self.rng.lognormal(np.log(450), 0.3),
            velocity_cv=self.rng.uniform(0.2, 0.55),
            straightness=self.rng.beta(8, 2),
            curvature=self.rng.beta(2.5, 3.5),
            precision=self.rng.beta(6, 2),
            tremor=self.rng.normal(6, 3.5),                        # noise injection, often off-band
            fitts_r2=self.rng.beta(5, 2.5),
            direction_changes=events * self.rng.uniform(0.04, 0.15),
            pause_count=events * self.rng.uniform(0.01, 0.06),
            pause_ms=self.rng.lognormal(np.log(450), 0.4),
            event_count=events,
        )

    # ------------------------------------------------------------------
    # Keyboard (10 features)
    # ------------------------------------------------------------------

    def _empty_keyboard(self) -> Dict:
        return {k: 0.0 for k in (
            'kb_avg_dwell_time', 'kb_dwell_time_std', 'kb_avg_flight_time',
            'kb_flight_time_std', 'kb_typing_speed', 'kb_paste_count',
            'kb_correction_ratio', 'kb_cadence_entropy', 'kb_total_events',
            'kb_total_duration')}

    def _keyboard(self, dwell: float, dwell_std: float, flight: float, flight_std: float,
                  paste_count: float, correction_ratio: float, entropy: float,
                  total_events: float) -> Dict:
        dwell, flight = self._pos(dwell), self._pos(flight)
        per_key_ms = max(dwell + flight, 1.0)
        return {
            'kb_avg_dwell_time': dwell,
            'kb_dwell_time_std': self._pos(dwell_std),
            'kb_avg_flight_time': flight,
            'kb_flight_time_std': self._pos(flight_std),
            'kb_typing_speed': 60000.0 / per_key_ms / 5.0,         # WPM (5 chars per word)
            'kb_paste_count': self._pos(paste_count),
            'kb_correction_ratio': self._clip01(correction_ratio),
            'kb_cadence_entropy': self._pos(entropy),
            'kb_total_events': self._pos(total_events),
            'kb_total_duration': self._pos(total_events) * per_key_ms / 1000.0,
        }

    def _human_keyboard(self) -> Dict:
        dwell = self.rng.normal(110, 25)                           # 80-150 ms
        flight = self.rng.lognormal(np.log(180), 0.35)             # 100-300 ms
        return self._keyboard(
            dwell=dwell,
            dwell_std=dwell * self.rng.uniform(0.2, 0.45),
            flight=flight,
            flight_std=flight * self.rng.uniform(0.3, 0.7),
            paste_count=self.rng.poisson(0.4),                     # password managers paste too
            correction_ratio=self.rng.beta(2, 25),
            entropy=self.rng.normal(4.0, 0.6),
            total_events=self._count(60, 30),
        )

    def _bot_keyboard(self, bot_type: str) -> Dict:
        if bot_type in ('simple_script', 'crawler'):
            return self._empty_keyboard()
        if bot_type == 'headless_browser':
            if self.rng.rand() < 0.5:
                kb = self._empty_keyboard()                        # element.value = '...'
                kb['kb_paste_count'] = 1.0
                return kb
            dwell = self.rng.uniform(0, 20)
            flight = self.rng.uniform(0, 50)
            return self._keyboard(
                dwell=dwell, dwell_std=dwell * self.rng.uniform(0, 0.05),
                flight=flight, flight_std=flight * self.rng.uniform(0, 0.05),
                paste_count=0, correction_ratio=0.0,
                entropy=self.rng.uniform(0.0, 1.0),
                total_events=self._count(30, 15),
            )
        # sophisticated_bot: randomised per-key delays, rarely makes corrections
        dwell = self.rng.normal(95, 20)
        flight = self.rng.lognormal(np.log(150), 0.3)
        return self._keyboard(
            dwell=dwell,
            dwell_std=dwell * self.rng.uniform(0.1, 0.35),
            flight=flight,
            flight_std=flight * self.rng.uniform(0.15, 0.5),
            paste_count=self.rng.poisson(0.2),
            correction_ratio=self.rng.beta(1, 40),
            entropy=self.rng.normal(3.3, 0.7),
            total_events=self._count(50, 25),
        )

    # ------------------------------------------------------------------
    # Scroll (5 features)
    # ------------------------------------------------------------------

    def _empty_scroll(self) -> Dict:
        return {k: 0.0 for k in (
            'scroll_avg_velocity', 'scroll_direction_changes', 'scroll_max_depth',
            'scroll_event_count', 'scroll_momentum_ratio')}

    def _human_scroll(self, device: str, bounced: bool) -> Dict:
        if bounced and self.rng.rand() < 0.5:
            return self._empty_scroll()
        events = self._count(10, 5) if bounced else self._count(60, 30)
        momentum = self.rng.uniform(0.5, 0.95) if device == 'mobile' else self.rng.uniform(0.05, 0.6)
        return {
            'scroll_avg_velocity': self.rng.lognormal(np.log(350), 0.5),
            'scroll_direction_changes': self._pos(self.rng.poisson(max(events / 15.0, 0.5))),
            'scroll_max_depth': self.rng.beta(2, 2) if not bounced else self.rng.beta(1, 5),
            'scroll_event_count': events,
            'scroll_momentum_ratio': momentum,
        }

    def _bot_scroll(self, bot_type: str) -> Dict:
        if bot_type in ('simple_script', 'crawler'):
            return self._empty_scroll()
        if bot_type == 'headless_browser':
            if self.rng.rand() < 0.5:
                return self._empty_scroll()
            return {
                'scroll_avg_velocity': self.rng.uniform(1500, 5000),  # window.scrollTo jumps
                'scroll_direction_changes': 0.0,
                'scroll_max_depth': self.rng.choice([0.5, 1.0]),
                'scroll_event_count': self._count(4, 2),
                'scroll_momentum_ratio': 0.0,
            }
        events = self._count(40, 20)
        return {
            'scroll_avg_velocity': self.rng.lognormal(np.log(500), 0.4),
            'scroll_direction_changes': self._pos(self.rng.poisson(max(events / 30.0, 0.3))),
            'scroll_max_depth': self.rng.beta(3, 1.5),
            'scroll_event_count': events,
            'scroll_momentum_ratio': self.rng.uniform(0.0, 0.4),
        }

    # ------------------------------------------------------------------
    # Touch (5 features)
    # ------------------------------------------------------------------

    def _empty_touch(self) -> Dict:
        return {k: 0.0 for k in (
            'touch_avg_pressure', 'touch_avg_radius', 'touch_swipe_velocity',
            'touch_tap_count', 'touch_multi_touch_ratio')}

    def _human_touch(self, bounced: bool) -> Dict:
        return {
            'touch_avg_pressure': self._clip01(self.rng.normal(0.5, 0.15)),
            'touch_avg_radius': self._pos(self.rng.normal(12, 3)),   # px
            'touch_swipe_velocity': self.rng.lognormal(np.log(800), 0.4),
            'touch_tap_count': self._count(3, 2) if bounced else self._count(20, 10),
            'touch_multi_touch_ratio': self.rng.beta(1, 15),
        }

    def _bot_touch(self, bot_type: str) -> Dict:
        emulates_mobile = {'headless_browser': 0.15, 'sophisticated_bot': 0.3}.get(bot_type, 0.0)
        if self.rng.rand() >= emulates_mobile:
            return self._empty_touch()
        if bot_type == 'headless_browser':
            return {                                                # CDP-dispatched touch events
                'touch_avg_pressure': self.rng.choice([0.0, 1.0]),
                'touch_avg_radius': self.rng.choice([0.0, 1.0]),
                'touch_swipe_velocity': self.rng.uniform(2000, 6000),
                'touch_tap_count': self._count(5, 2),
                'touch_multi_touch_ratio': 0.0,
            }
        return {
            'touch_avg_pressure': self._clip01(self.rng.normal(0.5, 0.05)),
            'touch_avg_radius': self._pos(self.rng.normal(11, 1)),
            'touch_swipe_velocity': self.rng.lognormal(np.log(900), 0.25),
            'touch_tap_count': self._count(15, 6),
            'touch_multi_touch_ratio': self.rng.beta(1, 60),
        }

    # ------------------------------------------------------------------
    # Session (5 features)
    # ------------------------------------------------------------------

    def _session(self, duration: float, requests: float, unique_ratio: float,
                 reputation: float) -> Dict:
        requests = max(requests, 1.0)
        duration = self._pos(duration)
        return {
            'session_duration': duration,
            'session_request_count': requests,
            'session_unique_paths': max(1.0, round(requests * self._clip01(unique_ratio))),
            'session_avg_time_between_requests': duration / requests,
            'session_reputation': self._clip01(reputation),
        }

    def _human_session(self, bounced: bool) -> Dict:
        if bounced:
            return self._session(self.rng.uniform(2, 15), self._count(2, 1),
                                 self.rng.uniform(0.8, 1.0), self.rng.beta(1.5, 8))
        return self._session(
            duration=self.rng.lognormal(np.log(240), 0.8),
            requests=self._count(12, 8),
            unique_ratio=self.rng.uniform(0.4, 0.9),
            reputation=self.rng.beta(1.5, 8),
        )

    def _bot_session(self, bot_type: str) -> Dict:
        if bot_type == 'crawler':
            requests = self._count(200, 120)
            return self._session(requests * self.rng.uniform(0.1, 1.5), requests,
                                 self.rng.uniform(0.85, 1.0), self.rng.beta(4, 3))
        if bot_type == 'simple_script':
            requests = self._count(40, 30)
            return self._session(requests * self.rng.uniform(0.05, 2.0), requests,
                                 self.rng.uniform(0.05, 0.4), self.rng.beta(4, 3))
        if bot_type == 'headless_browser':
            requests = self._count(25, 15)
            return self._session(requests * self.rng.uniform(0.5, 4.0), requests,
                                 self.rng.uniform(0.2, 0.7), self.rng.beta(3, 4))
        if bot_type == 'replay_bot':
            requests = self._count(14, 7)
            return self._session(                                   # replays human think-time, a bit faster
                duration=self.rng.lognormal(np.log(150), 0.6),
                requests=requests,
                unique_ratio=self.rng.uniform(0.35, 0.9),
                reputation=self.rng.beta(2, 7),
            )
        requests = self._count(15, 8)
        return self._session(                                       # sophisticated: paced like a human
            duration=requests * self.rng.lognormal(np.log(12), 0.6),
            requests=requests,
            unique_ratio=self.rng.uniform(0.3, 0.9),
            reputation=self.rng.beta(2, 6),
        )

    # ------------------------------------------------------------------
    # Network (5 features)
    # ------------------------------------------------------------------

    def _human_network(self) -> Dict:
        return {
            'is_vpn': self._flag(0.08),
            'is_tor': self._flag(0.005),
            'is_datacenter': self._flag(0.03),                     # corporate/cloud desktops
            'is_residential_proxy': self._flag(0.02),              # detector false positives
            'ip_reputation': self.rng.beta(1, 12),
        }

    def _bot_network(self, bot_type: str) -> Dict:
        residential = {'simple_script': 0.15, 'headless_browser': 0.25,
                       'sophisticated_bot': 0.6, 'crawler': 0.2,
                       'replay_bot': 0.7}[bot_type]
        uses_resi = self.rng.rand() < residential
        datacenter = 0.0 if uses_resi else self._flag(
            {'simple_script': 0.8, 'headless_browser': 0.7,
             'sophisticated_bot': 0.4, 'crawler': 0.85,
             'replay_bot': 0.4}[bot_type])
        # residential proxies are only flagged by the detector part of the time
        return {
            'is_vpn': self._flag(0.1),
            'is_tor': self._flag(0.03),
            'is_datacenter': datacenter,
            'is_residential_proxy': self._flag(0.55) if uses_resi else 0.0,
            'ip_reputation': self.rng.beta(2, 6) if uses_resi else self.rng.beta(3, 4),
        }

    # ------------------------------------------------------------------
    # Device fingerprint (5 features)
    # ------------------------------------------------------------------

    def _human_fingerprint(self, device: str) -> Dict:
        return {
            'has_webgl': self._flag(0.97),
            'has_canvas': self._flag(0.995),
            'plugin_count': 0.0 if device == 'mobile' else float(self.rng.choice([0, 5], p=[0.2, 0.8])),
            'is_headless': self._flag(0.005),
            'headless_confidence': self.rng.beta(1, 20),
        }

    def _bot_fingerprint(self, bot_type: str, device: str = 'desktop') -> Dict:
        if bot_type in ('simple_script', 'crawler'):
            # SDK never executes, so the fingerprint payload is empty
            return {'has_webgl': 0.0, 'has_canvas': 0.0, 'plugin_count': 0.0,
                    'is_headless': 0.0, 'headless_confidence': 0.0}
        if bot_type == 'headless_browser':
            return {
                'has_webgl': self._flag(0.5),                      # SwiftShader / disabled GPU
                'has_canvas': 1.0,
                'plugin_count': float(self.rng.choice([0, 5], p=[0.7, 0.3])),
                'is_headless': self._flag(0.7),
                'headless_confidence': self.rng.beta(6, 2),
            }
        if bot_type == 'replay_bot':                                # antidetect browser profile
            plugins = 0.0 if device == 'mobile' else float(self.rng.choice([0, 5], p=[0.3, 0.7]))
            return {
                'has_webgl': self._flag(0.9),
                'has_canvas': 1.0,
                'plugin_count': plugins,
                'is_headless': self._flag(0.05),
                'headless_confidence': self.rng.beta(1.5, 8),
            }
        return {                                                   # stealth plugins patch most leaks
            'has_webgl': self._flag(0.9),
            'has_canvas': 1.0,
            'plugin_count': float(self.rng.choice([0, 5], p=[0.3, 0.7])),
            'is_headless': self._flag(0.1),
            'headless_confidence': self.rng.beta(2, 6),
        }

    # ------------------------------------------------------------------
    # Difficulty-stratified generation
    # ------------------------------------------------------------------

    def generate_with_difficulty_levels(self, n_per_level=200) -> Tuple[List[Dict], np.ndarray, np.ndarray]:
        """Generate samples with difficulty labels for error analysis.
        Returns: (data, bot_labels, difficulty_labels)
        Difficulty: 0=easy, 1=medium, 2=hard (sophisticated bots),
        3=expert (replayed human traces)"""
        data = []
        bot_labels = []
        diff_labels = []
        level_bots = [('simple_script', 'crawler'), ('headless_browser',),
                      ('sophisticated_bot',), ('replay_bot',)]

        for level, bot_types in enumerate(level_bots):
            for i in range(n_per_level):
                data.append(self._generate_human())
                bot_labels.append(0)
                diff_labels.append(level)

                data.append(self._generate_bot(bot_types[i % len(bot_types)]))
                bot_labels.append(1)
                diff_labels.append(level)

        return data, np.array(bot_labels), np.array(diff_labels)
