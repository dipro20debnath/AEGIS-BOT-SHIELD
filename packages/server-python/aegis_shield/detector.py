from typing import Optional
from .models import AnalysisResult

class RequestAnalyzer:
    """Analyzes HTTP request properties for bot indicators."""
    
    def analyze(self, ip: str, headers: dict, method: str, path: str, behavioral_data: dict = None) -> AnalysisResult:
        score = 0.0
        reasons = []
        
        ua = headers.get('user-agent', '').lower()
        if not ua:
            score += 40
            reasons.append("missing_user_agent")
        else:
            known_bot = self._check_known_bots(ua)
            if known_bot:
                score += 80
                reasons.append(f"known_bot:{known_bot}")
            
            ua_issues = self._analyze_user_agent(ua)
            if ua_issues:
                score += len(ua_issues) * 20
                reasons.extend(ua_issues)
                
        header_issues = self._analyze_headers(headers)
        if header_issues:
            score += len(header_issues) * 10
            reasons.extend(header_issues)
            
        if behavioral_data:
            behavior_score = self._score_behavioral_data(behavioral_data)
            score += behavior_score
            if behavior_score > 20:
                reasons.append("suspicious_behavior")
        else:
            score += 50
            reasons.append("missing_aegis_token")
            
        return AnalysisResult(score=min(100.0, score), reason=",".join(reasons))

    def _analyze_headers(self, headers: dict) -> list:
        issues = []
        lower_headers = {k.lower(): v for k, v in headers.items()}
        if 'accept' not in lower_headers:
            issues.append("missing_accept_header")
        if 'host' not in lower_headers:
            issues.append("missing_host_header")
        return issues

    def _analyze_user_agent(self, ua: str) -> list:
        if 'python' in ua or 'curl' in ua or 'wget' in ua:
            return ["cli_tool"]
        return []

    def _score_behavioral_data(self, data: dict) -> float:
        score = 0.0
        if not data.get('mouse_moved', True):
            score += 20
        if data.get('automation_detected', False):
            score += 80
        if data.get('webdriver', False):
            score += 80
        return score

    def _check_known_bots(self, ua: str) -> Optional[str]:
        ua = ua.lower()
        if 'googlebot' in ua:
            return 'googlebot'
        if 'bingbot' in ua:
            return 'bingbot'
        if 'headless' in ua:
            return 'headless_browser'
        return None
