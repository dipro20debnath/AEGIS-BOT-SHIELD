"""
Feature Extraction Pipeline for Bot Detection

Extracts 50+ features from behavioral data collected by the JS SDK.
Features are grouped into categories for ablation study (thesis requirement).

Feature Categories:
1. Mouse dynamics (15 features)
2. Keyboard dynamics (10 features)
3. Scroll behavior (5 features)
4. Touch behavior (5 features)
5. Session patterns (5 features)
6. Network/protocol (5 features)
7. Device fingerprint (5 features)
"""
import numpy as np
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field


@dataclass
class FeatureVector:
    """A labeled feature vector for training/inference."""
    features: np.ndarray
    feature_names: List[str]
    category_indices: Dict[str, List[int]]  # category -> feature indices
    metadata: Dict[str, Any] = field(default_factory=dict)


class FeatureExtractor:
    """Extracts ML features from raw behavioral data."""

    FEATURE_CATEGORIES = {
        'mouse': [
            'mouse_avg_velocity', 'mouse_velocity_std', 'mouse_max_velocity',
            'mouse_avg_acceleration', 'mouse_acceleration_std',
            'mouse_avg_jerk', 'mouse_straightness_index', 'mouse_curvature_score',
            'mouse_click_precision', 'mouse_micro_tremor_freq',
            'mouse_fitts_law_r2', 'mouse_direction_changes',
            'mouse_pause_count', 'mouse_avg_pause_duration', 'mouse_event_count',
        ],
        'keyboard': [
            'kb_avg_dwell_time', 'kb_dwell_time_std',
            'kb_avg_flight_time', 'kb_flight_time_std',
            'kb_typing_speed', 'kb_paste_count', 'kb_correction_ratio',
            'kb_cadence_entropy', 'kb_total_events', 'kb_total_duration',
        ],
        'scroll': [
            'scroll_avg_velocity', 'scroll_direction_changes',
            'scroll_max_depth', 'scroll_event_count', 'scroll_momentum_ratio',
        ],
        'touch': [
            'touch_avg_pressure', 'touch_avg_radius',
            'touch_swipe_velocity', 'touch_tap_count', 'touch_multi_touch_ratio',
        ],
        'session': [
            'session_duration', 'session_request_count', 'session_unique_paths',
            'session_avg_time_between_requests', 'session_reputation',
        ],
        'network': [
            'is_vpn', 'is_tor', 'is_datacenter', 'is_residential_proxy',
            'ip_reputation',
        ],
        'fingerprint': [
            'has_webgl', 'has_canvas', 'plugin_count',
            'is_headless', 'headless_confidence',
        ],
    }

    # Coarser groups for group ablation. The four behavioral categories carry
    # overlapping information, so removing any one of them alone barely moves
    # the metrics; removing them together shows their joint contribution.
    FEATURE_GROUPS = {
        'behavior': ['mouse', 'keyboard', 'scroll', 'touch'],
        'session': ['session'],
        'network': ['network'],
        'fingerprint': ['fingerprint'],
    }

    def __init__(self):
        self.all_feature_names = []
        self.category_indices = {}
        idx = 0
        for cat, names in self.FEATURE_CATEGORIES.items():
            indices = list(range(idx, idx + len(names)))
            self.category_indices[cat] = indices
            self.all_feature_names.extend(names)
            idx += len(names)

    def extract(self, raw_data: Dict[str, Any]) -> FeatureVector:
        """Extract feature vector from raw behavioral data."""
        features = np.zeros(len(self.all_feature_names), dtype=np.float32)

        # Extract each category
        mouse_data = raw_data.get('mouse', {})
        features[self.category_indices['mouse']] = self._extract_mouse(mouse_data)

        kb_data = raw_data.get('keyboard', {})
        features[self.category_indices['keyboard']] = self._extract_keyboard(kb_data)
        
        scroll_data = raw_data.get('scroll', {})
        features[self.category_indices['scroll']] = self._extract_scroll(scroll_data)
        
        touch_data = raw_data.get('touch', {})
        features[self.category_indices['touch']] = self._extract_touch(touch_data)
        
        session_data = raw_data.get('session', {})
        features[self.category_indices['session']] = self._extract_session(session_data)
        
        network_data = raw_data.get('network', {})
        features[self.category_indices['network']] = self._extract_network(network_data)
        
        fp_data = raw_data.get('fingerprint', {})
        features[self.category_indices['fingerprint']] = self._extract_fingerprint(fp_data)

        # Replace NaN/Inf with 0
        features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)

        return FeatureVector(
            features=features,
            feature_names=self.all_feature_names.copy(),
            category_indices=self.category_indices.copy(),
            metadata={'timestamp': raw_data.get('timestamp', 0)}
        )

    def extract_batch(self, data_list: List[Dict]) -> np.ndarray:
        """Extract features for a batch of samples."""
        return np.array([self.extract(d).features for d in data_list])

    def _extract_mouse(self, data: Dict[str, Any]) -> np.ndarray:
        return np.array([
            data.get('mouse_avg_velocity', 0.0), data.get('mouse_velocity_std', 0.0),
            data.get('mouse_max_velocity', 0.0), data.get('mouse_avg_acceleration', 0.0),
            data.get('mouse_acceleration_std', 0.0), data.get('mouse_avg_jerk', 0.0),
            data.get('mouse_straightness_index', 0.0), data.get('mouse_curvature_score', 0.0),
            data.get('mouse_click_precision', 0.0), data.get('mouse_micro_tremor_freq', 0.0),
            data.get('mouse_fitts_law_r2', 0.0), data.get('mouse_direction_changes', 0.0),
            data.get('mouse_pause_count', 0.0), data.get('mouse_avg_pause_duration', 0.0),
            data.get('mouse_event_count', 0.0)
        ], dtype=np.float32)

    def _extract_keyboard(self, data: Dict[str, Any]) -> np.ndarray:
        return np.array([
            data.get('kb_avg_dwell_time', 0.0), data.get('kb_dwell_time_std', 0.0),
            data.get('kb_avg_flight_time', 0.0), data.get('kb_flight_time_std', 0.0),
            data.get('kb_typing_speed', 0.0), data.get('kb_paste_count', 0.0),
            data.get('kb_correction_ratio', 0.0), data.get('kb_cadence_entropy', 0.0),
            data.get('kb_total_events', 0.0), data.get('kb_total_duration', 0.0)
        ], dtype=np.float32)

    def _extract_scroll(self, data: Dict[str, Any]) -> np.ndarray:
        return np.array([
            data.get('scroll_avg_velocity', 0.0), data.get('scroll_direction_changes', 0.0),
            data.get('scroll_max_depth', 0.0), data.get('scroll_event_count', 0.0),
            data.get('scroll_momentum_ratio', 0.0)
        ], dtype=np.float32)

    def _extract_touch(self, data: Dict[str, Any]) -> np.ndarray:
        return np.array([
            data.get('touch_avg_pressure', 0.0), data.get('touch_avg_radius', 0.0),
            data.get('touch_swipe_velocity', 0.0), data.get('touch_tap_count', 0.0),
            data.get('touch_multi_touch_ratio', 0.0)
        ], dtype=np.float32)

    def _extract_session(self, data: Dict[str, Any]) -> np.ndarray:
        return np.array([
            data.get('session_duration', 0.0), data.get('session_request_count', 0.0),
            data.get('session_unique_paths', 0.0), data.get('session_avg_time_between_requests', 0.0),
            data.get('session_reputation', 0.0)
        ], dtype=np.float32)

    def _extract_network(self, data: Dict[str, Any]) -> np.ndarray:
        return np.array([
            data.get('is_vpn', 0.0), data.get('is_tor', 0.0),
            data.get('is_datacenter', 0.0), data.get('is_residential_proxy', 0.0),
            data.get('ip_reputation', 0.0)
        ], dtype=np.float32)

    def _extract_fingerprint(self, data: Dict[str, Any]) -> np.ndarray:
        return np.array([
            data.get('has_webgl', 0.0), data.get('has_canvas', 0.0),
            data.get('plugin_count', 0.0), data.get('is_headless', 0.0),
            data.get('headless_confidence', 0.0)
        ], dtype=np.float32)

    def group_indices(self, group: str) -> List[int]:
        """Feature indices belonging to a FEATURE_GROUPS entry."""
        return sorted(i for cat in self.FEATURE_GROUPS[group] for i in self.category_indices[cat])

    def get_feature_importance_by_category(self, importances: np.ndarray) -> Dict[str, float]:
        """Aggregate feature importances by category (for thesis ablation study)."""
        result = {}
        for cat, indices in self.category_indices.items():
            result[cat] = float(np.mean(importances[indices]))
        return result
