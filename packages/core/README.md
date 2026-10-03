# @aegis/core

Detection engine of [AEGIS BOT SHIELD](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/README.md): request signals (IP
intelligence, header and TLS/HTTP2 fingerprints, rate limits, honeypots,
threat lists, input-pattern checks, session patterns), noisy-OR risk fusion,
the shared token format, the memory-hard proof-of-work challenge, request
signing, and shared state (in-process or Redis).

Most applications use it through
[`@aegis/server-node`](https://www.npmjs.com/package/@aegis/server-node) rather than directly.

```ts
import { DetectionEngine } from '@aegis/core';

const engine = new DetectionEngine({ siteKey: 'my-site', secretKey: process.env.AEGIS_SECRET_KEY!, mode: 'monitor' });
await engine.init();
const result = await engine.analyze({ ip, headers, method: 'GET', path: '/login', timestamp: Date.now(), requestId: 'r1' });
// result.riskScore.score, result.verdict, result.signals, result.threats (OWASP OAT labels)
```

- Options: [configuration.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/configuration.md#detection-engine-engine-option-aegiscore)
- API: [API_REFERENCE.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/API_REFERENCE.md#core-library-aegiscore)
- Security model and limits: [security-whitepaper.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/security-whitepaper.md)

Node.js ≥ 22. MIT licence.
