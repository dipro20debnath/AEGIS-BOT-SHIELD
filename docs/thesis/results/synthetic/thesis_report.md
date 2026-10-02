# AEGIS BOT SHIELD: Training Report

## 1. Overall Performance
- **Accuracy**: 0.9747
- **F1 Score**: 0.9744
- **Precision**: 0.9863
- **Recall**: 0.9627
- **False Positive Rate**: 0.0133
- **AUC-ROC**: 0.9957

## 1b. Decision Threshold
Target FPR <= 2.00%; tuned for FPR <= 1.50% (safety margin) on out-of-fold + validation predictions (2125 humans): threshold = 0.8469 (held-out FPR 0.0146, recall 0.9525).

| Threshold | Accuracy | Precision | Recall | F1 | FPR |
|-----------|----------|-----------|--------|----|-----|
| 0.5000 | 0.9720 | 0.9758 | 0.9680 | 0.9719 | 0.0240 |
| 0.8469 | 0.9747 | 0.9863 | 0.9627 | 0.9744 | 0.0133 |

## 2. Ablation Study Results
| Removed Category | Accuracy | Accuracy Drop | F1 Score |
|------------------|----------|---------------|----------|
| mouse | 0.9760 | -0.0040 | 0.9759 |
| keyboard | 0.9747 | -0.0027 | 0.9745 |
| scroll | 0.9693 | +0.0027 | 0.9691 |
| touch | 0.9720 | +0.0000 | 0.9719 |
| session | 0.9707 | +0.0013 | 0.9705 |
| network | 0.9293 | +0.0427 | 0.9275 |
| fingerprint | 0.9600 | +0.0120 | 0.9597 |

## 3. Group Ablation (cross-validated)
| Configuration | Features | AUC | F1 @0.5 | Recall @FPR<=2% |
|---------------|----------|-----|---------|------------------|
| full | 50 | 0.9962 ± 0.0015 | 0.9706 ± 0.0044 | 0.9648 ± 0.0095 |
| without_behavior | 15 | 0.9947 ± 0.0028 | 0.9631 ± 0.0106 | 0.9524 ± 0.0154 |
| only_behavior | 35 | 0.9115 ± 0.0063 | 0.8784 ± 0.0112 | 0.8036 ± 0.0187 |
| without_session | 45 | 0.9949 ± 0.0016 | 0.9663 ± 0.0065 | 0.9504 ± 0.0120 |
| only_session | 5 | 0.8976 ± 0.0109 | 0.8020 ± 0.0073 | 0.6460 ± 0.0143 |
| without_network | 45 | 0.9807 ± 0.0033 | 0.9359 ± 0.0068 | 0.8884 ± 0.0200 |
| only_network | 5 | 0.9467 ± 0.0078 | 0.8981 ± 0.0073 | 0.6612 ± 0.0560 |
| without_fingerprint | 45 | 0.9921 ± 0.0020 | 0.9588 ± 0.0058 | 0.9320 ± 0.0271 |
| only_fingerprint | 5 | 0.9464 ± 0.0039 | 0.8878 ± 0.0070 | 0.7788 ± 0.0176 |

## 4. Per Bot Type (fresh test set, tuned threshold)
| Class | Rate |
|-------|------|
| human_fpr | 0.0140 |
| simple_script_recall | 1.0000 |
| headless_browser_recall | 1.0000 |
| sophisticated_bot_recall | 0.9850 |
| crawler_recall | 1.0000 |
| replay_bot_recall | 0.7680 |

## 5. Inference Latency (2000 uncached single requests)
| mean | p50 | p95 | p99 |
|------|-----|-----|-----|
| 1.269 ms | 1.244 ms | 1.664 ms | 2.770 ms |
