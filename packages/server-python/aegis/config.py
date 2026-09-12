from dataclasses import dataclass, field
from typing import Optional, List
from .models import ProtectionMode

@dataclass
class AegisConfig:
    secret_key: str
    protection_mode: ProtectionMode = ProtectionMode.ENFORCE
    fail_open: bool = True
    token_header_name: str = "X-Aegis-Token"
    token_cookie_name: str = "aegis_token"
    routes_to_protect: List[str] = field(default_factory=list)
    routes_to_exclude: List[str] = field(default_factory=list)
    
    def __post_init__(self):
        if not self.secret_key:
            raise ValueError("AegisConfig requires a valid secret_key")
