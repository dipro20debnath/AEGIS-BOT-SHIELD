# AEGIS BOT SHIELD - Architecture Documentation

## System Overview

AEGIS BOT SHIELD is a comprehensive, enterprise-grade bot defense framework designed to detect and mitigate automated threats across web, mobile, and API endpoints. 

```text
+-------------------+       +-------------------+       +-------------------+
|                   |       |                   |       |                   |
|   Client Device   |       |   Web Server /    |       |   AEGIS Engine    |
|  (Browser/Mobile) |       |   API Gateway     |       |   (ML & Rules)    |
|                   |       |                   |       |                   |
+--------+----------+       +--------+----------+       +--------+----------+
         |                           |                           |
         | 1. Collect Telemetry      |                           |
         |-------------------------->|                           |
         |                           | 2. Forward Payload        |
         |                           |-------------------------->|
         |                           |                           | 3. Analyze Data
         |                           |                           | (Rules + ML)
         |                           |                           |
         |                           | 4. Return Verdict         |
         |                           |<--------------------------|
         | 5. Allow / Block / CAPTCHA|                           |
         |<--------------------------|                           |
         |                           |                           |
```

## The 5-Layer Defense Model

AEGIS utilizes a unique 5-layer defense architecture to provide maximum security with minimal false positives.

### 1. Static Rule Engine (Layer 1)
The first line of defense evaluates static HTTP headers, known bad IPs (via threat intelligence feeds), User-Agent signatures, and basic rate limiting. It operates in microseconds and filters out rudimentary volumetric attacks.

### 2. Client Telemetry & Fingerprinting (Layer 2)
The JavaScript SDK collects hardware, software, and browser-specific metrics (canvas, WebGL, audio context, font enumeration, screen resolution). This generates a robust device fingerprint capable of identifying headless browsers (Puppeteer, Selenium, Playwright).

### 3. Behavioral Analysis (Layer 3)
Tracks user interaction patterns such as mouse movements, keystroke dynamics, touch events, and scroll behavior. Bots often exhibit rigid, perfectly linear, or unnaturally fast interactions that deviate from human norms.

### 4. Machine Learning Engine (Layer 4)
A Random Forest / Gradient Boosting classifier trained on millions of labeled bot/human interactions. It evaluates a 50-dimensional feature vector in real-time, catching sophisticated hybrid bots that bypass the first three layers.

### 5. Cryptographic Proof-of-Work (Layer 5)
In high-risk scenarios (or when confidence scores are borderline), AEGIS issues a silent client-side computational challenge (Proof-of-Work). This imposes an economic cost on botnet operators while remaining invisible to legitimate users.

## Data Flow (Client → Server → ML → Verdict)

1. **Initialization:** The AEGIS JS SDK is injected into the client's HTML.
2. **Telemetry Collection:** Upon user interaction (e.g., submitting a form), the SDK encrypts behavioral and fingerprint data into a `aegis-token`.
3. **Transmission:** The token is sent to the backend server via HTTP headers or body payload.
4. **Middleware Interception:** The AEGIS server middleware (Express, Flask, FastAPI) intercepts the request and extracts the token.
5. **Decryption & Validation:** The token is decrypted (AES-256-GCM) and its HMAC signature verified.
6. **Engine Analysis:** 
    - The rule engine checks for static violations.
    - The ML engine evaluates the feature vector and outputs a probability score (0.0 = Human, 1.0 = Bot).
7. **Verdict Generation:** Based on configured thresholds, the engine returns a verdict: `ALLOW`, `BLOCK`, `CHALLENGE`, or `MONITOR`.
8. **Enforcement:** The middleware enforces the verdict (e.g., returning a 403 Forbidden).

## Package Structure

The repository is organized into modular packages:

```
aegis-bot-shield/
├── packages/
│   ├── aegis-client/      # Client-side JavaScript SDK
│   ├── aegis-core/        # Core detection logic, rules, and scoring
│   ├── aegis-ml/          # Machine learning model training and inference
│   ├── aegis-node/        # Express/Fastify/Node.js middleware
│   ├── aegis-python/      # Django/Flask/FastAPI middleware
│   └── aegis-dashboard/   # Real-time monitoring UI
├── docs/                  # Project documentation
├── examples/              # Integration examples
└── tests/                 # Unit, integration, and E2E tests
```

## Core Modules

### `aegis-client`
Handles execution environment checks (webdriver, CDP presence), event listener attachment, payload encryption, and PoW execution. Designed to be lightweight (< 20KB minified/gzipped).

### `aegis-core`
The central brain of the system. Maintains the state of active sessions, caches threat intelligence data, orchestrates the evaluation pipeline, and manages the rule configuration.

### `aegis-ml`
Built with Python (scikit-learn/TensorFlow). Responsible for feature extraction, model training, hyperparameter tuning, and exporting models for inference (e.g., ONNX format for cross-language support).

## Security Considerations

- **Payload Encryption:** All client-to-server telemetry is encrypted using AES-256-GCM to prevent eavesdropping and reverse-engineering of the fingerprinting logic.
- **Integrity Verification:** Payloads are signed with HMAC-SHA256. Any tampering invalidates the request immediately.
- **Replay Protection:** Every payload includes a cryptographic nonce and a strict timestamp. Replayed tokens are rejected.
- **Obfuscation:** The JS SDK undergoes aggressive minification, string obfuscation, and control flow flattening to deter static analysis by attackers.
