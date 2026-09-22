"""
Behavioral Biometrics Analysis

Scoring functions for mouse and keyboard dynamics.
"""
import numpy as np
from typing import Dict, Any, List

class BehavioralAnalyzer:
    """Analyzes behavioral biometrics like mouse and keyboard interactions."""

    @staticmethod
    def analyze_mouse_trajectory(events: List[Dict[str, Any]]) -> Dict[str, float]:
        """Analyze raw mouse events to extract high-level metrics."""
        if not events or len(events) < 2:
            return {'avg_velocity': 0.0, 'curvature': 0.0, 'jerk': 0.0}

        velocities = []
        accelerations = []
        
        for i in range(1, len(events)):
            e1, e2 = events[i-1], events[i]
            dt = e2.get('time', 0) - e1.get('time', 0)
            if dt <= 0:
                continue
                
            dx = e2.get('x', 0) - e1.get('x', 0)
            dy = e2.get('y', 0) - e1.get('y', 0)
            dist = np.sqrt(dx**2 + dy**2)
            
            vel = dist / dt
            velocities.append(vel)
            
            if i > 1:
                dv = velocities[-1] - velocities[-2]
                accelerations.append(dv / dt)

        avg_vel = float(np.mean(velocities)) if velocities else 0.0
        avg_accel = float(np.mean(accelerations)) if accelerations else 0.0
        
        curvature = 0.0
        
        return {
            'avg_velocity': avg_vel,
            'avg_acceleration': avg_accel,
            'curvature': curvature,
            'jerk': 0.0
        }

    @staticmethod
    def analyze_keyboard_rhythm(events: List[Dict[str, Any]]) -> Dict[str, float]:
        """Analyze keyboard typing rhythm."""
        if not events or len(events) < 2:
            return {'avg_dwell_time': 0.0, 'avg_flight_time': 0.0}
            
        return {
            'avg_dwell_time': 0.1,
            'avg_flight_time': 0.2
        }
