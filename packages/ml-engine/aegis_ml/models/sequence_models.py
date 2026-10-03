"""
Sequence classifiers on raw mouse trajectories (1D-CNN and bidirectional LSTM).

Input: encode_sequences() arrays, shape (n, T, 3) with per-event (dx, dy, dt)
and the true lengths. Requires PyTorch (pip install "aegis-ml-engine[deep]").
The interface mirrors sklearn (fit / predict_proba) so the comparison code
treats them like the tree models.
"""
from typing import Optional

import numpy as np

try:
    import torch
    from torch import nn
except ImportError:  # pragma: no cover
    torch = None
    nn = None


def _require_torch():
    if torch is None:
        raise ImportError('PyTorch is required: pip install "aegis-ml-engine[deep]"')


if nn is not None:
    class _CNN(nn.Module):
        def __init__(self, channels: int = 6):
            super().__init__()
            self.conv = nn.Sequential(
                nn.Conv1d(channels, 32, 5, padding=2), nn.ReLU(),
                nn.Conv1d(32, 64, 5, padding=4, dilation=2), nn.ReLU(),
                nn.Conv1d(64, 64, 5, padding=8, dilation=4), nn.ReLU(),
            )
            self.head = nn.Sequential(nn.Linear(128, 32), nn.ReLU(), nn.Linear(32, 1))

        def forward(self, x, lengths):
            h = self.conv(x.transpose(1, 2))  # (n, 64, T)
            mask = (torch.arange(h.shape[2])[None, :] < lengths[:, None]).unsqueeze(1)
            mean = (h * mask).sum(2) / mask.sum(2).clamp(min=1)
            mx = h.masked_fill(~mask, -1e9).max(2).values
            return self.head(torch.cat([mean, mx], 1)).squeeze(1)

    class _LSTM(nn.Module):
        def __init__(self, channels: int = 6, hidden: int = 64):
            super().__init__()
            # A strided convolution shortens the sequence 4x before the LSTM, which
            # makes long trajectories (300+ events) trainable on CPU
            self.down = nn.Sequential(nn.Conv1d(channels, 32, 5, stride=2, padding=2), nn.ReLU(),
                                      nn.Conv1d(32, 32, 5, stride=2, padding=2), nn.ReLU())
            self.lstm = nn.LSTM(32, hidden, batch_first=True, bidirectional=True)
            self.head = nn.Sequential(nn.Linear(2 * hidden, 32), nn.ReLU(), nn.Linear(32, 1))

        def forward(self, x, lengths):
            h = self.down(x.transpose(1, 2)).transpose(1, 2)
            short = ((lengths + 3) // 4).clamp(min=1, max=h.shape[1])
            packed = nn.utils.rnn.pack_padded_sequence(h, short.cpu(), batch_first=True, enforce_sorted=False)
            _, (h, _) = self.lstm(packed)
            return self.head(torch.cat([h[-2], h[-1]], 1)).squeeze(1)


class SequenceClassifier:
    """kind = 'cnn' or 'lstm'. fit() keeps the epoch with the best validation loss."""

    def __init__(self, kind: str = 'cnn', epochs: int = 25, batch_size: int = 32, lr: float = 1e-3,
                 seed: int = 0, val_fraction: float = 0.15):
        _require_torch()
        self.kind, self.epochs, self.batch_size, self.lr = kind, epochs, batch_size, lr
        self.seed, self.val_fraction = seed, val_fraction
        self.model: Optional[nn.Module] = None
        self.history: list = []
        self.mean: Optional[np.ndarray] = None
        self.std: Optional[np.ndarray] = None

    def _scale(self, X: np.ndarray, lengths: np.ndarray) -> np.ndarray:
        mask = (np.arange(X.shape[1])[None, :] < lengths[:, None])[..., None]
        return ((X - self.mean) / self.std * mask).astype(np.float32)

    def _new_model(self):
        return _CNN() if self.kind == 'cnn' else _LSTM()

    def fit(self, X: np.ndarray, lengths: np.ndarray, y: np.ndarray) -> 'SequenceClassifier':
        torch.manual_seed(self.seed)
        rng = np.random.RandomState(self.seed)
        idx = rng.permutation(len(y))
        n_val = int(len(y) * self.val_fraction)
        val, tr = idx[:n_val], idx[n_val:]
        valid = X[np.arange(X.shape[1])[None, :] < lengths[:, None]]
        self.mean, self.std = valid.mean(axis=0), valid.std(axis=0) + 1e-6
        Xt = torch.tensor(self._scale(X, lengths))
        Lt, yt = torch.tensor(lengths), torch.tensor(y, dtype=torch.float32)
        self.model = self._new_model()
        opt = torch.optim.Adam(self.model.parameters(), lr=self.lr)
        loss_fn = nn.BCEWithLogitsLoss()
        best, best_state = np.inf, None
        for epoch in range(self.epochs):
            self.model.train()
            for b in np.array_split(rng.permutation(tr), max(1, len(tr) // self.batch_size)):
                opt.zero_grad()
                loss = loss_fn(self.model(Xt[b], Lt[b]), yt[b])
                loss.backward()
                nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                opt.step()
            self.model.eval()
            with torch.no_grad():
                val_loss = float(loss_fn(self.model(Xt[val], Lt[val]), yt[val])) if n_val else 0.0
            self.history.append(val_loss)
            if val_loss < best:
                best, best_state = val_loss, {k: v.clone() for k, v in self.model.state_dict().items()}
        if best_state is not None:
            self.model.load_state_dict(best_state)
        return self

    def predict_proba(self, X: np.ndarray, lengths: np.ndarray) -> np.ndarray:
        self.model.eval()
        with torch.no_grad():
            out = []
            for s in range(0, len(X), 512):
                xs = self._scale(X[s:s + 512], lengths[s:s + 512])
                logits = self.model(torch.tensor(xs), torch.tensor(lengths[s:s + 512]))
                out.append(torch.sigmoid(logits).numpy())
        p = np.concatenate(out) if out else np.zeros(0)
        return np.column_stack([1 - p, p])
