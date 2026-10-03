"""Hand-crafted features of a trajectory (the non-deep baseline) and the sequence encoding."""
from typing import List

import numpy as np

TRAJECTORY_FEATURES = [
    'velocity_mean', 'velocity_std', 'velocity_max', 'accel_std', 'jerk_mean', 'straightness',
    'direction_change_rate', 'dt_mean', 'dt_cv', 'pause_ratio', 'event_count', 'tremor_power',
    'curvature_mean', 'zero_dt_ratio',
]


def trajectory_features(traj: np.ndarray) -> np.ndarray:
    xy, t = traj[:, :2], traj[:, 2]
    d = np.diff(xy, axis=0)
    dt = np.diff(t)
    dt_safe = np.where(dt <= 0, 1.0, dt)
    step = np.linalg.norm(d, axis=1)
    v = step / dt_safe
    a = np.diff(v) / dt_safe[1:] if len(v) > 1 else np.zeros(1)
    j = np.diff(a) / dt_safe[2:] if len(a) > 1 else np.zeros(1)
    path_len = step.sum()
    straight = np.linalg.norm(xy[-1] - xy[0]) / path_len if path_len > 0 else 1.0
    ang = np.arctan2(d[:, 1], d[:, 0])
    dang = np.abs(np.angle(np.exp(1j * np.diff(ang)))) if len(ang) > 1 else np.zeros(1)
    # Tremor: share of high-frequency (8-12 Hz band) energy in the detrended speed signal
    if len(v) > 16 and dt_safe.mean() > 0:
        sig = v - np.convolve(v, np.ones(5) / 5, mode='same')
        spec = np.abs(np.fft.rfft(sig)) ** 2
        freqs = np.fft.rfftfreq(len(sig), d=dt_safe.mean() / 1000)
        band = (freqs >= 8) & (freqs <= 12)
        tremor = float(spec[band].sum() / (spec.sum() + 1e-9))
    else:
        tremor = 0.0
    return np.array([
        v.mean(), v.std(), v.max(), np.abs(a).std(), np.abs(j).mean(), straight,
        (dang > 0.35).mean(), dt.mean(), dt.std() / (dt.mean() + 1e-9), (dt > 100).mean(), len(t), tremor,
        dang.mean(), (dt <= 0).mean(),
    ], dtype=float)


def feature_matrix(trajs: List[np.ndarray]) -> np.ndarray:
    return np.nan_to_num(np.stack([trajectory_features(tr) for tr in trajs]), posinf=0.0, neginf=0.0)


SEQUENCE_CHANNELS = ['dx', 'dy', 'log_dt', 'log_speed', 'turn_angle', 'is_pause']


def encode_sequences(trajs: List[np.ndarray], length: int = 320) -> np.ndarray:
    """(n, length, 6) per-event channels (see SEQUENCE_CHANNELS), zero-padded at the end.
    Long trajectories keep their first `length` events. SequenceClassifier
    standardises the channels on the training data."""
    out = np.zeros((len(trajs), length, len(SEQUENCE_CHANNELS)), dtype=np.float32)
    for i, tr in enumerate(trajs):
        d = np.diff(tr, axis=0)[:length]
        n = len(d)
        if n == 0:
            continue
        dt = np.clip(d[:, 2], 0, None)
        dist = np.hypot(d[:, 0], d[:, 1])
        ang = np.arctan2(d[:, 1], d[:, 0])
        turn = np.zeros(n)
        turn[1:] = np.angle(np.exp(1j * np.diff(ang)))
        out[i, :n, 0] = np.clip(d[:, 0], -200, 200) / 20
        out[i, :n, 1] = np.clip(d[:, 1], -200, 200) / 20
        out[i, :n, 2] = np.log1p(dt)
        out[i, :n, 3] = np.log1p(dist / np.maximum(dt, 1.0))
        out[i, :n, 4] = turn
        out[i, :n, 5] = (dt > 100).astype(np.float32)
    return out
