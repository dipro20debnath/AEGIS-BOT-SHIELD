import numpy as np
import pandas as pd
from typing import Tuple

def generate_synthetic_data(n_samples: int = 10000, bot_ratio: float = 0.3) -> pd.DataFrame:
    """Generate synthetic dataset for training/testing"""
    
    n_bots = int(n_samples * bot_ratio)
    n_humans = n_samples - n_bots
    
    # Human features (normal distributions)
    human_data = {
        'ip_freq_1h': np.random.poisson(2, n_humans),
        'req_rate': np.random.normal(0.5, 0.2, n_humans),
        'unique_ua_count': np.random.poisson(1, n_humans),
        'mouse_speed': np.random.normal(150, 40, n_humans),
        'mouse_accel': np.random.normal(30, 10, n_humans),
        'click_rate': np.random.normal(0.2, 0.1, n_humans),
        'scroll_depth': np.random.randint(100, 5000, n_humans),
        'canvas_fp_anomaly': np.random.binomial(1, 0.01, n_humans),
        'webdriver_present': np.zeros(n_humans),
        'is_bot': np.zeros(n_humans)
    }
    
    # Bot features (different distributions)
    bot_data = {
        'ip_freq_1h': np.random.poisson(50, n_bots),
        'req_rate': np.random.normal(10.0, 5.0, n_bots),
        'unique_ua_count': np.random.poisson(5, n_bots),
        'mouse_speed': np.random.normal(0, 5, n_bots),  # Often 0 or perfect lines
        'mouse_accel': np.random.normal(0, 2, n_bots),
        'click_rate': np.random.normal(5.0, 2.0, n_bots),
        'scroll_depth': np.random.randint(0, 200, n_bots), # Less scrolling
        'canvas_fp_anomaly': np.random.binomial(1, 0.8, n_bots),
        'webdriver_present': np.random.binomial(1, 0.6, n_bots),
        'is_bot': np.ones(n_bots)
    }
    
    df_human = pd.DataFrame(human_data)
    df_bot = pd.DataFrame(bot_data)
    
    # Ensure no negative values for rates/speeds
    for df in [df_human, df_bot]:
        for col in ['req_rate', 'mouse_speed', 'mouse_accel', 'click_rate']:
            df[col] = df[col].clip(lower=0.0)
            
    # Combine and shuffle
    df = pd.concat([df_human, df_bot], ignore_index=True)
    return df.sample(frac=1).reset_index(drop=True)

if __name__ == '__main__':
    df = generate_synthetic_data()
    df.to_csv('synthetic_dataset.csv', index=False)
    print(f"Generated {len(df)} samples saved to synthetic_dataset.csv")
