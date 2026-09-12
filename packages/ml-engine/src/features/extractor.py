import numpy as np
import pandas as pd
from typing import Dict, Any, List

class FeatureExtractor:
    """Extracts features from raw request and behavioral data"""
    def __init__(self):
        self.network_features = ['ip_freq_1h', 'req_rate', 'unique_ua_count']
        self.behavioral_features = ['mouse_speed', 'mouse_accel', 'click_rate', 'scroll_depth']
        
    def extract(self, raw_data: Dict[str, Any]) -> pd.DataFrame:
        features = {}
        
        # Network Features
        network = raw_data.get('network', {})
        features['ip_freq_1h'] = network.get('ip_freq_1h', 0)
        features['req_rate'] = network.get('req_rate', 0.0)
        features['unique_ua_count'] = network.get('unique_ua_count', 1)
        
        # Behavioral Features
        behavior = raw_data.get('behavior', {})
        features['mouse_speed'] = behavior.get('avg_speed', 0.0)
        features['mouse_accel'] = behavior.get('avg_accel', 0.0)
        features['click_rate'] = behavior.get('click_rate', 0.0)
        features['scroll_depth'] = behavior.get('max_scroll', 0)
        
        # Device Features
        device = raw_data.get('device', {})
        features['canvas_fp_anomaly'] = 1 if device.get('canvas_fp_changed', False) else 0
        features['webdriver_present'] = 1 if device.get('webdriver', False) else 0
        
        return pd.DataFrame([features])
        
    def normalize(self, df: pd.DataFrame) -> pd.DataFrame:
        # In production, this would use a fitted StandardScaler
        return (df - df.mean()) / (df.std() + 1e-9)
