# API Reference

This document details the Application Programming Interfaces (APIs) provided by the AEGIS BOT SHIELD framework.

## 1. Core Engine API (Node.js / Python)

The `aegis-core` package exposes the primary interface for evaluating requests.

### `DetectionEngine`

The main class responsible for processing incoming telemetry and generating verdicts.

#### Methods

- `init(config: AegisConfig): void`
  Initializes the engine with the provided configuration.
- `evaluate(payload: string, reqContext: RequestContext): Promise<Verdict>`
  Evaluates an encrypted payload from the client alongside server-side request context (IP, headers).
- `updateThreatIntel(data: ThreatIntelData): void`
  Hot-reloads threat intelligence rules without restarting the engine.

### `RiskScorer`

Calculates the final risk score based on inputs from all 5 defense layers.

- `calculateScore(ruleScore: number, mlScore: number, behaviorScore: number): number`

## 2. JS SDK API (`aegis-client`)

The client-side SDK injected into web applications.

### `AegisClient`

#### Initialization

```javascript
import AegisClient from '@aegis/client';

const aegis = new AegisClient({
  siteKey: 'your_site_key',
  endpoint: '/aegis-verify',
  debug: false
});

aegis.init();
```

#### Methods

- `init()`: Starts background telemetry collection.
- `getToken(): Promise<string>`: Generates an encrypted payload for submission with forms or API requests.
- `solveChallenge(difficulty: number): Promise<string>`: Executes the Proof-of-Work challenge.

## 3. Server Middleware API

AEGIS provides plug-and-play middleware for popular web frameworks.

### Express.js

```javascript
const { aegisExpress } = require('@aegis/node');

app.use(aegisExpress({
  secretKey: process.env.AEGIS_SECRET,
  blockMode: true
}));
```

### FastAPI (Python)

```python
from aegis_python.fastapi import AegisMiddleware

app.add_middleware(
    AegisMiddleware,
    secret_key="YOUR_SECRET_KEY",
    action_on_bot="block"
)
```

## 4. ML Engine API

Python APIs for training and utilizing the machine learning models.

### `BotClassifier`

- `train(features: pd.DataFrame, labels: pd.Series): void`
- `predict(feature_vector: np.array): float`
- `export_model(path: str, format: str = 'onnx'): void`

### `FeatureExtractor`

- `extract_from_payload(payload: dict): np.array`
  Converts raw JSON telemetry into the 50-dimensional feature vector expected by the model.

## 5. REST API Endpoints (Dashboard / Reporting)

If running AEGIS in standalone mode, it exposes the following HTTP endpoints:

- `POST /aegis/verify`
  Accepts a JSON body with `{"token": "..."}`. Returns `{"verdict": "ALLOW|BLOCK", "score": 0.1}`.
- `GET /health`
  Returns the health status of the engine and ML model.
- `GET /stats/realtime`
  Returns JSON statistics on traffic volume, block rates, and average risk scores.

## 6. Configuration Options

Global configuration shared across the Core Engine and Middlewares:

```json
{
  "secretKey": "REQUIRED",
  "siteKey": "REQUIRED",
  "thresholds": {
    "block": 0.85,
    "challenge": 0.65,
    "monitor": 0.40
  },
  "features": {
    "enableML": true,
    "enablePoW": true,
    "enableBehaviorTracking": true
  },
  "rateLimit": {
    "windowMs": 60000,
    "maxRequests": 100
  }
}
```
