"""Settings from environment variables (all prefixed STUDY_ except the AEGIS ones)."""
import os
from dataclasses import dataclass, field
from typing import Optional

#: Bump when the information sheet or consent text changes; stored with every session.
CONSENT_VERSION = "2026-10-05"


@dataclass
class StudyConfig:
    #: SQLite file with all study data
    db_path: str = "study.db"
    #: Signs the study session cookie and the AEGIS tokens (at least 16 characters)
    secret_key: str = ""
    site_key: str = "aegis-study"
    #: AEGIS ML model used for live scores (optional; scores are recorded, never enforced)
    ml_model_path: Optional[str] = None
    #: Set when the site is served over HTTPS (adds the Secure flag to cookies)
    secure_cookies: bool = False
    #: Store raw event timings for participants who opt in (False = aggregates only, for every participant)
    raw_events_enabled: bool = True
    #: Largest accepted raw-event batch, bytes
    max_raw_batch: int = 512 * 1024
    #: Log requests that do not belong to a study session (unlabelled traffic)
    log_unlabelled: bool = True
    #: Wrong study-code attempts allowed per client address per 10 minutes
    code_attempts: int = 10
    consent_version: str = CONSENT_VERSION
    #: Path of the AEGIS SDK bundle on disk (packages/js-sdk/dist)
    sdk_dir: str = field(default_factory=lambda: os.path.join(
        os.path.dirname(__file__), "..", "..", "packages", "js-sdk", "dist"))

    @classmethod
    def from_env(cls) -> "StudyConfig":
        def flag(name: str, default: bool) -> bool:
            return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes")

        config = cls(
            db_path=os.getenv("STUDY_DB", "study.db"),
            secret_key=os.getenv("AEGIS_SECRET_KEY", ""),
            site_key=os.getenv("AEGIS_SITE_KEY", "aegis-study"),
            ml_model_path=os.getenv("AEGIS_ML_MODEL_PATH") or None,
            secure_cookies=flag("STUDY_SECURE_COOKIES", False),
            raw_events_enabled=flag("STUDY_RAW_EVENTS", True),
            log_unlabelled=flag("STUDY_LOG_UNLABELLED", True),
        )
        if os.getenv("STUDY_SDK_DIR"):
            config.sdk_dir = os.environ["STUDY_SDK_DIR"]
        return config

    def validate(self) -> None:
        if len(self.secret_key) < 16:
            raise ValueError("AEGIS_SECRET_KEY must be at least 16 characters")
