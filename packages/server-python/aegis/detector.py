from typing import Dict, Any
import time

class RequestAnalyzer:
    """Basic in-memory request analyzer for lightweight standalone use"""
    def __init__(self):
        self.ip_history = {}
        
    def analyze(self, ip: str, headers: Dict[str, str]) -> Dict[str, Any]:
        now = time.time()
        
        # Rate limiting logic
        if ip not in self.ip_history:
            self.ip_history[ip] = []
            
        # Clean up old requests (older than 1 min)
        self.ip_history[ip] = [t for t in self.ip_history[ip] if now - t < 60]
        self.ip_history[ip].append(now)
        
        req_count = len(self.ip_history[ip])
        
        risk_score = 0.0
        
        if req_count > 100:
            risk_score = min(1.0, req_count / 200.0)
            
        user_agent = headers.get('User-Agent', '')
        if not user_agent or 'bot' in user_agent.lower() or 'scraper' in user_agent.lower():
            risk_score += 0.5
            
        return {
            "risk_score": min(1.0, risk_score),
            "factors": {
                "rate": req_count,
                "ua_suspicious": 1 if not user_agent else 0
            }
        }
