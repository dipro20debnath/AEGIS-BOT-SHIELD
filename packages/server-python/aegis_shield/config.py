import os
from pydantic_settings import BaseSettings

class AegisEnvConfig(BaseSettings):
    aegis_site_key: str = os.getenv("AEGIS_SITE_KEY", "")
    aegis_secret_key: str = os.getenv("AEGIS_SECRET_KEY", "")
    aegis_block_threshold: int = int(os.getenv("AEGIS_BLOCK_THRESHOLD", "80"))
    aegis_challenge_threshold: int = int(os.getenv("AEGIS_CHALLENGE_THRESHOLD", "50"))
    aegis_fail_open: bool = os.getenv("AEGIS_FAIL_OPEN", "true").lower() == "true"

    class Config:
        env_prefix = ''
        
def get_config() -> AegisEnvConfig:
    return AegisEnvConfig()
