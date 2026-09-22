"""
Synthetic Data Generator for Bot Detection Training

Generates realistic training data since real bot data is hard to collect.
Used for initial model training before real data collection.

Generates two classes:
1. Human-like behavioral data (natural, variable, imperfect)
2. Bot-like behavioral data (mechanical, precise, uniform)

Based on published research:
- Balabit Mouse Dynamics Dataset patterns
- Academic papers on keystroke dynamics
- Known bot automation characteristics
"""
import numpy as np
from typing import List, Dict, Tuple


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

    def _generate_human(self) -> Dict:
        """Generate human-like behavioral data."""
        return {
            'mouse': self._human_mouse(),
            'keyboard': self._human_keyboard(),
            'scroll': self._human_scroll(),
            'touch': self._human_touch(),
            'session': self._human_session(),
            'network': self._human_network(),
            'fingerprint': self._human_fingerprint(),
        }

    def _generate_bot(self, bot_type=None) -> Dict:
        """Generate bot-like behavioral data with variations."""
        if bot_type is None:
            bot_type = self.rng.choice(['simple_script', 'headless_browser', 'sophisticated_bot', 'crawler'])
            
        return {
            'mouse': self._bot_mouse(bot_type),
            'keyboard': self._bot_keyboard(bot_type),
            'scroll': self._bot_scroll(bot_type),
            'touch': self._bot_touch(bot_type),
            'session': self._bot_session(bot_type),
            'network': self._bot_network(bot_type),
            'fingerprint': self._bot_fingerprint(bot_type),
        }

    def _human_mouse(self) -> Dict:
        return {
            'avg_velocity': self.rng.normal(400, 100),  # 200-600 px/s
            'velocity_std': self.rng.normal(100, 30),
            'straightness': self.rng.uniform(0.6, 0.9),
            'micro_tremor_hz': self.rng.normal(10, 2),  # 8-12 Hz
            'fitts_law_r2': self.rng.uniform(0.7, 0.95),
            'curvature': self.rng.uniform(0.3, 0.8),
            'event_count': int(self.rng.normal(100, 30))
        }
        
    def _bot_mouse(self, bot_type: str) -> Dict:
        if bot_type == 'simple_script':
            return { 'avg_velocity': 0.0, 'velocity_std': 0.0, 'straightness': 1.0, 'micro_tremor_hz': 0.0, 'fitts_law_r2': 0.0, 'curvature': 0.0, 'event_count': 0 }
        elif bot_type == 'headless_browser':
            return { 'avg_velocity': self.rng.uniform(1000, 2000), 'velocity_std': 0.1, 'straightness': 0.99, 'micro_tremor_hz': 0.0, 'fitts_law_r2': 0.1, 'curvature': 0.01, 'event_count': int(self.rng.normal(20, 2)) }
        else: # sophisticated
            return { 'avg_velocity': self.rng.normal(400, 20), 'velocity_std': self.rng.normal(20, 5), 'straightness': self.rng.uniform(0.85, 0.95), 'micro_tremor_hz': self.rng.uniform(0, 5), 'fitts_law_r2': self.rng.uniform(0.4, 0.7), 'curvature': self.rng.uniform(0.1, 0.4), 'event_count': int(self.rng.normal(50, 10)) }

    def _human_keyboard(self) -> Dict:
        return {
            'dwell_time_avg': self.rng.normal(115, 25), # 80-150ms
            'dwell_time_std': self.rng.normal(35, 10),
            'flight_time_avg': self.rng.normal(200, 50), # 100-300ms
            'flight_time_std': self.rng.normal(55, 15),
            'typing_speed_wpm': self.rng.normal(55, 15),
            'cadence_entropy': self.rng.uniform(3.0, 5.0),
            'paste_count': int(self.rng.poisson(0.5))
        }
        
    def _bot_keyboard(self, bot_type: str) -> Dict:
        if bot_type == 'simple_script':
            return { 'dwell_time_avg': 0.0, 'dwell_time_std': 0.0, 'flight_time_avg': 0.0, 'flight_time_std': 0.0, 'typing_speed_wpm': 0.0, 'cadence_entropy': 0.0, 'paste_count': 1 }
        elif bot_type == 'headless_browser':
            return { 'dwell_time_avg': 50.0, 'dwell_time_std': 0.1, 'flight_time_avg': 50.0, 'flight_time_std': 0.1, 'typing_speed_wpm': 500.0, 'cadence_entropy': 0.1, 'paste_count': 0 }
        else:
            return { 'dwell_time_avg': self.rng.normal(100, 5), 'dwell_time_std': self.rng.normal(5, 1), 'flight_time_avg': self.rng.normal(150, 10), 'flight_time_std': self.rng.normal(10, 2), 'typing_speed_wpm': self.rng.normal(80, 5), 'cadence_entropy': self.rng.uniform(1.0, 2.5), 'paste_count': 0 }

    def _human_scroll(self) -> Dict:
        return {
            'scroll_speed_avg': self.rng.normal(300, 100),
            'scroll_speed_std': self.rng.normal(150, 50),
            'direction_changes': int(self.rng.poisson(2)),
            'event_count': int(self.rng.normal(50, 20))
        }
        
    def _bot_scroll(self, bot_type: str) -> Dict:
        if bot_type in ['simple_script', 'crawler']:
            return { 'scroll_speed_avg': 0.0, 'scroll_speed_std': 0.0, 'direction_changes': 0, 'event_count': 0 }
        else:
            return { 'scroll_speed_avg': self.rng.uniform(1000, 3000), 'scroll_speed_std': 0.0, 'direction_changes': 0, 'event_count': 5 }

    def _human_touch(self) -> Dict:
        return {
            'touch_pressure_avg': self.rng.normal(0.5, 0.2),
            'touch_area_avg': self.rng.normal(0.4, 0.1),
            'swipe_velocity': self.rng.normal(800, 200),
            'event_count': int(self.rng.normal(20, 10))
        }
        
    def _bot_touch(self, bot_type: str) -> Dict:
        return { 'touch_pressure_avg': 0.0, 'touch_area_avg': 0.0, 'swipe_velocity': 0.0, 'event_count': 0 }

    def _human_session(self) -> Dict:
        return {
            'session_duration_sec': self.rng.exponential(300),
            'pages_visited': int(self.rng.normal(4, 2)),
            'idle_time_ratio': self.rng.uniform(0.1, 0.7)
        }
        
    def _bot_session(self, bot_type: str) -> Dict:
        if bot_type == 'crawler':
            return { 'session_duration_sec': self.rng.uniform(1, 5), 'pages_visited': 1, 'idle_time_ratio': 0.0 }
        else:
            return { 'session_duration_sec': self.rng.uniform(5, 30), 'pages_visited': int(self.rng.uniform(1, 10)), 'idle_time_ratio': self.rng.uniform(0.0, 0.1) }

    def _human_network(self) -> Dict:
        return {
            'request_rate_hz': self.rng.exponential(0.5),
            'unique_endpoints': int(self.rng.normal(5, 2)),
            'error_rate': self.rng.uniform(0.0, 0.05)
        }
        
    def _bot_network(self, bot_type: str) -> Dict:
        if bot_type == 'crawler':
            return { 'request_rate_hz': self.rng.uniform(5, 20), 'unique_endpoints': 1, 'error_rate': 0.0 }
        else:
            return { 'request_rate_hz': self.rng.uniform(2, 10), 'unique_endpoints': int(self.rng.uniform(1, 3)), 'error_rate': self.rng.uniform(0.0, 0.2) }

    def _human_fingerprint(self) -> Dict:
        return {
            'webdriver_present': False,
            'canvas_noise': self.rng.uniform(0.8, 1.0),
            'fonts_count': int(self.rng.normal(50, 20)),
            'consistent_resolution': True
        }
        
    def _bot_fingerprint(self, bot_type: str) -> Dict:
        if bot_type == 'simple_script':
            return { 'webdriver_present': False, 'canvas_noise': 0.0, 'fonts_count': 0, 'consistent_resolution': True }
        elif bot_type == 'headless_browser':
            return { 'webdriver_present': True, 'canvas_noise': 1.0, 'fonts_count': 3, 'consistent_resolution': False }
        else:
            return { 'webdriver_present': False, 'canvas_noise': 0.5, 'fonts_count': 20, 'consistent_resolution': True }

    def generate_with_difficulty_levels(self, n_per_level=200) -> Tuple[List[Dict], np.ndarray, np.ndarray]:
        """Generate samples with difficulty labels for error analysis.
        Returns: (data, bot_labels, difficulty_labels)
        Difficulty: 0=easy, 1=medium, 2=hard (sophisticated bots)"""
        data = []
        bot_labels = []
        diff_labels = []
        
        # Easy (Simple Scripts vs Clear Humans)
        for _ in range(n_per_level):
            data.append(self._generate_human())
            bot_labels.append(0)
            diff_labels.append(0)
            
            data.append(self._generate_bot('simple_script'))
            bot_labels.append(1)
            diff_labels.append(0)
            
        # Medium (Headless vs Average Humans)
        for _ in range(n_per_level):
            data.append(self._generate_human())
            bot_labels.append(0)
            diff_labels.append(1)
            
            data.append(self._generate_bot('headless_browser'))
            bot_labels.append(1)
            diff_labels.append(1)
            
        # Hard (Sophisticated vs Edge-case Humans)
        for _ in range(n_per_level):
            data.append(self._generate_human())
            bot_labels.append(0)
            diff_labels.append(2)
            
            data.append(self._generate_bot('sophisticated_bot'))
            bot_labels.append(1)
            diff_labels.append(2)
            
        return data, np.array(bot_labels), np.array(diff_labels)
