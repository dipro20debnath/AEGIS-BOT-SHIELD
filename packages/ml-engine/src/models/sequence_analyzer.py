import torch
import torch.nn as nn
import numpy as np
from typing import List

class LSTMSequenceModel(nn.Module):
    def __init__(self, input_size: int, hidden_size: int = 64, num_layers: int = 2):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, 1)
        self.sigmoid = nn.Sigmoid()
        
    def forward(self, x):
        _, (h_n, _) = self.lstm(x)
        # Use last hidden state
        out = self.fc(h_n[-1])
        return self.sigmoid(out)

class SequenceAnalyzer:
    """Analyzes sequences of user actions (clickstreams)"""
    def __init__(self, input_size: int = 5):
        self.model = LSTMSequenceModel(input_size)
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model.to(self.device)
        
    def predict_sequence(self, sequence: np.ndarray) -> float:
        """
        sequence: (seq_len, input_size) array of events
        Returns probability of being a bot
        """
        self.model.eval()
        with torch.no_grad():
            x = torch.FloatTensor(sequence).unsqueeze(0).to(self.device)
            prob = self.model(x).item()
        return prob
