<div align="center">
  <h1>🛡️ AEGIS BOT SHIELD</h1>
  <p><strong>International-Grade Bot Defense & Fraud Prevention SDK</strong></p>
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![Version](https://img.shields.io/badge/version-1.0.0-success.svg)](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD)
  [![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
  [![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)]()
  [![Node](https://img.shields.io/badge/Node-16+-green.svg)]()
</div>

---

AEGIS BOT SHIELD is a comprehensive, open-source bot detection framework that utilizes advanced machine learning, behavioral biometrics, and cryptographic proof-of-work to protect web applications and APIs from automated threats.

## ✨ Features

- 🧠 **Machine Learning Engine:** Real-time Random Forest & XGBoost classifiers trained on behavioral data.
- 🖐️ **Behavioral Biometrics:** Analyzes mouse movements, keystroke dynamics, and scroll patterns.
- 🧬 **Advanced Fingerprinting:** WebGL, Canvas, and AudioContext fingerprinting to detect headless browsers (Puppeteer, Selenium).
- 🧩 **Cryptographic Proof-of-Work:** Imposes computational costs on suspicious traffic.
- ⚡ **Ultra-Low Latency:** Inference times < 10ms for minimal impact on legitimate users.
- 🔒 **End-to-End Encryption:** AES-256-GCM encrypted telemetry payloads.
- 🔌 **Plug & Play Middleware:** Native support for Express, FastAPI, Flask, and Django.

## 🏗️ Architecture Overview

AEGIS employs a unique **5-Layer Defense Model**:
1. **Static Rules:** HTTP headers, Threat Intel IPs, Rate Limiting.
2. **Client Fingerprinting:** Hardware & Browser signatures.
3. **Behavioral Analysis:** Interaction entropy and dynamics.
4. **ML Classifier:** 50-dimensional feature vector evaluation.
5. **Proof-of-Work Challenge:** Silent computational challenges for borderline scores.

*See the [Architecture Documentation](docs/ARCHITECTURE.md) for a deep dive.*

## 🚀 Quick Start

### 1. Installation

**Node.js (Express / Fastify)**
```bash
npm install @aegis-bot-shield/client @aegis-bot-shield/node
```

**Python (FastAPI / Flask / Django)**
```bash
pip install aegis-bot-shield-python
```

### 2. Frontend Integration

Inject the AEGIS SDK into your HTML and generate a token before submitting sensitive requests.

```html
<script src="https://cdn.aegis-shield.com/v1/aegis.min.js"></script>
<script>
  const aegis = new AegisClient({ siteKey: 'YOUR_SITE_KEY' });
  aegis.init();

  async function performAction() {
      const token = await aegis.getToken();
      fetch('/api/secure', {
          headers: { 'X-Aegis-Token': token }
      });
  }
</script>
```

### 3. Backend Integration (Express.js Example)

```javascript
const express = require('express');
const { aegisExpress } = require('@aegis-bot-shield/node');

const app = express();

app.post('/api/login', aegisExpress({
    secretKey: process.env.AEGIS_SECRET_KEY,
    blockMode: true
}), (req, res) => {
    // If we reach here, the request is from a verified human
    res.json({ success: true });
});
```

## 📚 Documentation

For complete documentation, check the `docs/` directory:
- [API Reference](docs/API_REFERENCE.md)
- [Integration Guide](docs/INTEGRATION_GUIDE.md)
- [Machine Learning Model Guide](docs/ML_MODEL_GUIDE.md)
- [Architecture Details](docs/ARCHITECTURE.md)

## 🛠️ Technology Stack

- **Client:** TypeScript, Web APIs
- **Core Engine:** Node.js, Python
- **Machine Learning:** Scikit-learn, XGBoost, ONNX Runtime
- **Cryptography:** WebCrypto API, PyCryptodome

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details on how to submit pull requests, report issues, and propose new features.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
