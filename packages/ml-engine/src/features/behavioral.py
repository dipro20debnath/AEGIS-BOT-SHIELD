import numpy as np
from typing import List, Dict, Any

class BehavioralFeatureEngine:
    """Computes complex behavioral metrics from raw event streams"""
    
    @staticmethod
    def analyze_mouse_trajectory(events: List[Dict[str, Any]]) -> Dict[str, float]:
        if len(events) < 2:
            return {"velocity": 0.0, "acceleration": 0.0, "jerk": 0.0, "curvature": 0.0}
            
        times = np.array([e['t'] for e in events])
        xs = np.array([e['x'] for e in events])
        ys = np.array([e['y'] for e in events])
        
        dt = np.diff(times)
        dt[dt == 0] = 1.0 # prevent division by zero
        
        dx = np.diff(xs)
        dy = np.diff(ys)
        
        distances = np.sqrt(dx**2 + dy**2)
        velocities = distances / dt
        
        dv = np.diff(velocities)
        dt_v = dt[1:]
        accelerations = dv / dt_v
        
        da = np.diff(accelerations) if len(accelerations) > 1 else np.array([0])
        dt_a = dt_v[1:] if len(dt_v) > 1 else np.array([1])
        jerks = da / dt_a
        
        return {
            "velocity": float(np.mean(velocities)),
            "acceleration": float(np.mean(accelerations)) if len(accelerations) > 0 else 0.0,
            "jerk": float(np.mean(jerks)) if len(jerks) > 0 else 0.0,
            "curvature": float(np.std(np.arctan2(dy, dx)))
        }

    @staticmethod
    def analyze_keyboard_dynamics(events: List[Dict[str, Any]]) -> Dict[str, float]:
        if len(events) < 2:
            return {"dwell_time_mean": 0.0, "flight_time_var": 0.0}
            
        dwell_times = []
        flight_times = []
        
        # Simplified: assumes sorted events with 'type' (keydown/keyup), 'key', 't'
        # In reality requires complex state tracking per key
        return {
            "dwell_time_mean": 120.5, # placeholder
            "flight_time_var": 45.2   # placeholder
        }
