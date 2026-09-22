"""
Request Sequence Analysis

Markov chain model to analyze page transitions.
"""
from collections import defaultdict
from typing import List, Dict
import math

class SequenceAnalyzer:
    """Analyzes request sequences using Markov Chains."""

    def __init__(self):
        self.transition_counts = defaultdict(lambda: defaultdict(int))
        self.state_counts = defaultdict(int)
        self.transition_probs = defaultdict(lambda: defaultdict(float))
        self.is_trained = False

    def train(self, sequences: List[List[str]]):
        """Train Markov model on a list of request path sequences."""
        for seq in sequences:
            if not seq:
                continue
            for i in range(len(seq) - 1):
                state_a = seq[i]
                state_b = seq[i+1]
                self.transition_counts[state_a][state_b] += 1
                self.state_counts[state_a] += 1

        for state_a, transitions in self.transition_counts.items():
            total = self.state_counts[state_a]
            for state_b, count in transitions.items():
                self.transition_probs[state_a][state_b] = count / total

        self.is_trained = True

    def calculate_sequence_score(self, sequence: List[str]) -> float:
        """Calculate anomaly score for a sequence. Lower score = more anomalous."""
        if not self.is_trained:
            raise ValueError("Model not trained.")
            
        if len(sequence) < 2:
            return 1.0
            
        log_prob = 0.0
        for i in range(len(sequence) - 1):
            state_a = sequence[i]
            state_b = sequence[i+1]
            
            prob = self.transition_probs.get(state_a, {}).get(state_b, 1e-6)
            log_prob += math.log(prob)
            
        return log_prob / (len(sequence) - 1)
