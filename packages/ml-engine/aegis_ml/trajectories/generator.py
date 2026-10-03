"""
Synthetic mouse trajectories for sequence models (Phase C).

A trajectory is an array of browser mousemove events (x px, y px, t ms) for a
visitor moving the pointer to several targets on a 1366x768 page.

Human model (motor-control literature):
- point-to-point movements follow the minimum-jerk profile (Flash & Hogan 1985);
- movement time follows Fitts' law, MT = a + b log2(D/W + 1) (Fitts 1954), with noise;
- paths bend (perpendicular offset), and ~35% of movements overshoot and correct;
- 8-12 Hz physiological tremor and slow drift are added;
- events arrive at an irregular browser rate (about 60-125 Hz, with gaps), and
  coordinates are integer pixels.

Bot models reproduce common automation tools:
- linear: straight constant-speed steps (Selenium ActionChains, Playwright mouse.move(steps));
- teleport: jump to the target in one or two events;
- bezier: cubic Bezier paths with easing, optional overshoot, no tremor (ghost-cursor style);
- humanized: minimum-jerk + Gaussian noise but white noise instead of tremor and
  metronomic event timing (a careful script);
- replay: a recorded human trajectory translated/scaled to new targets and replayed
  with a time factor (very hard by construction).

These are simulations. A sequence model can learn artefacts of the simulator, so
results on them show the method works, not how it performs on real people.
"""
from typing import List, Optional, Tuple

import numpy as np

TRAJECTORY_BOT_TYPES = ['linear', 'teleport', 'bezier', 'humanized', 'replay']
SCREEN = (1366, 768)


class TrajectoryGenerator:
    def __init__(self, seed: int = 0):
        self.rng = np.random.RandomState(seed)

    # ------------------------------------------------------------------ helpers

    def _targets(self, n: int) -> np.ndarray:
        return np.column_stack([self.rng.uniform(40, SCREEN[0] - 40, n), self.rng.uniform(40, SCREEN[1] - 40, n)])

    def _fitts_ms(self, dist: float, width: float) -> float:
        a, b = self.rng.normal(100, 15), self.rng.normal(150, 25)
        return max(120.0, (a + b * np.log2(dist / width + 1)) * self.rng.lognormal(0, 0.15))

    def _event_times(self, duration: float, human: bool) -> np.ndarray:
        """Event timestamps within a movement (ms from its start)."""
        if human:
            base = self.rng.choice([8.3, 11.1, 16.7])  # 120/90/60 Hz devices
            gaps = np.abs(self.rng.normal(base, base * 0.25, int(duration / base) + 4))
            gaps[self.rng.rand(len(gaps)) < 0.03] *= self.rng.uniform(2, 4)  # dropped frames
            t = np.cumsum(gaps)
        else:
            step = self.rng.choice([10.0, 16.0, 20.0])
            t = np.arange(step, duration + step, step)
        t = t[t < duration]
        return np.append(t, duration)

    @staticmethod
    def _min_jerk(tau: np.ndarray) -> np.ndarray:
        return 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5

    def _human_move(self, p0: np.ndarray, p1: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        dist = float(np.linalg.norm(p1 - p0)) + 1e-6
        width = self.rng.uniform(20, 80)
        overshoot = self.rng.rand() < 0.35
        aim = p1 + (p1 - p0) / dist * dist * self.rng.uniform(0.04, 0.1) if overshoot else p1
        duration = self._fitts_ms(dist, width)
        t = self._event_times(duration, human=True)
        tau = t / duration
        s = self._min_jerk(tau)[:, None]
        path = p0 + (aim - p0) * s
        normal = np.array([-(aim - p0)[1], (aim - p0)[0]]) / (np.linalg.norm(aim - p0) + 1e-6)
        path += normal * (self.rng.normal(0, 0.06) * dist * np.sin(np.pi * tau))[:, None]
        if overshoot:  # corrective sub-movement back to the target
            d2 = self._fitts_ms(float(np.linalg.norm(p1 - aim)) + 1, width) * 0.6
            t2 = self._event_times(d2, human=True)
            path2 = aim + (p1 - aim) * self._min_jerk(t2 / d2)[:, None]
            path, t = np.vstack([path, path2]), np.concatenate([t, duration + t2])
        # 8-12 Hz tremor (amplitude ~0.5 px) and slow drift
        f = self.rng.uniform(8, 12)
        phase = self.rng.uniform(0, 2 * np.pi, 2)
        amp = self.rng.uniform(0.3, 1.0)
        path += amp * np.column_stack([np.sin(2 * np.pi * f * t / 1000 + phase[0]),
                                       np.sin(2 * np.pi * f * t / 1000 + phase[1])])
        path += np.cumsum(self.rng.normal(0, 0.15, path.shape), axis=0)
        return np.round(path), t

    def _pause(self, human: bool) -> float:
        return float(self.rng.lognormal(np.log(350), 0.6)) if human else float(self.rng.choice([0, 50, 100, 200]))

    # --------------------------------------------------------------- generators

    def human(self, n_moves: int = 4) -> np.ndarray:
        pts = self._targets(n_moves + 1)
        out, clock = [np.array([[*pts[0], 0.0]])], 0.0
        for i in range(n_moves):
            path, t = self._human_move(pts[i], pts[i + 1])
            out.append(np.column_stack([path, clock + t]))
            clock += t[-1] + self._pause(True)
        return np.vstack(out)

    def bot(self, kind: str, n_moves: int = 4, source: Optional[np.ndarray] = None) -> np.ndarray:
        pts = self._targets(n_moves + 1)
        if kind == 'replay':
            return self._replay(source if source is not None else self.human(n_moves))
        out, clock = [np.array([[*pts[0], 0.0]])], 0.0
        for i in range(n_moves):
            p0, p1 = pts[i], pts[i + 1]
            dist = float(np.linalg.norm(p1 - p0))
            if kind == 'linear':
                steps = int(self.rng.choice([10, 20, 25, 50]))
                s = np.linspace(0, 1, steps + 1)[1:, None]
                path, t = p0 + (p1 - p0) * s, np.arange(1, steps + 1) * float(self.rng.choice([0.0, 5.0, 16.0]) or 1.0)
            elif kind == 'teleport':
                path, t = p1[None, :], np.array([float(self.rng.choice([1.0, 5.0, 30.0]))])
            elif kind == 'bezier':
                path, t = self._bezier(p0, p1, dist)
            elif kind == 'humanized':
                duration = self._fitts_ms(dist, 40)
                t = self._event_times(duration, human=False)
                path = p0 + (p1 - p0) * self._min_jerk(t / duration)[:, None]
                path += self.rng.normal(0, 1.0, path.shape)
            else:
                raise ValueError(kind)
            out.append(np.column_stack([np.round(path), clock + t]))
            clock += t[-1] + self._pause(False)
        return np.vstack(out)

    def _bezier(self, p0: np.ndarray, p1: np.ndarray, dist: float) -> Tuple[np.ndarray, np.ndarray]:
        """ghost-cursor style: cubic Bezier with random control points, eased, ~uniform timing."""
        spread = min(200.0, dist) * self.rng.uniform(0.1, 0.5)
        d = (p1 - p0) / (dist + 1e-6)
        n = np.array([-d[1], d[0]])
        c1 = p0 + d * dist * 0.3 + n * self.rng.uniform(-spread, spread)
        c2 = p0 + d * dist * 0.7 + n * self.rng.uniform(-spread, spread)
        steps = int(np.clip(np.ceil(np.log2(dist / 30 + 1) * 25), 25, 100))
        s = np.linspace(0, 1, steps + 1)[1:]
        s = 0.5 - 0.5 * np.cos(np.pi * s)  # ease in/out
        b = ((1 - s) ** 3)[:, None] * p0 + (3 * (1 - s) ** 2 * s)[:, None] * c1 \
            + (3 * (1 - s) * s ** 2)[:, None] * c2 + (s ** 3)[:, None] * p1
        t = np.cumsum(np.abs(self.rng.normal(16, 2, steps)))
        return b, t

    def _replay(self, recording: np.ndarray) -> np.ndarray:
        """Translate/scale a human recording, stretch time, add slight jitter."""
        xy, t = recording[:, :2].copy(), recording[:, 2].copy()
        scale = self.rng.uniform(0.8, 1.2)
        xy = (xy - xy.mean(axis=0)) * scale + np.array(SCREEN) / 2 + self.rng.uniform(-200, 200, 2)
        xy = np.clip(xy + self.rng.normal(0, 0.5, xy.shape), 0, None)
        return np.column_stack([np.round(xy), t * self.rng.uniform(0.9, 1.1)])

    def dataset(self, n_human: int, n_bot_per_type: int,
                bot_types: Optional[List[str]] = None) -> Tuple[List[np.ndarray], np.ndarray, np.ndarray]:
        """Trajectories, labels (1 = bot) and type per trajectory."""
        bot_types = bot_types or TRAJECTORY_BOT_TYPES
        trajs, types = [], []
        humans = [self.human(int(self.rng.randint(3, 7))) for _ in range(n_human)]
        trajs += humans
        types += ['human'] * n_human
        for kind in bot_types:
            for _ in range(n_bot_per_type):
                n_moves = int(self.rng.randint(3, 7))
                # Replays use fresh recordings (not the training humans themselves)
                trajs.append(self.bot(kind, n_moves, self.human(n_moves) if kind == 'replay' else None))
                types.append(kind)
        types = np.array(types)
        return trajs, (types != 'human').astype(int), types
