# @aegis/js-sdk

Browser SDK of [AEGIS BOT SHIELD](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/README.md). It collects behavioural
statistics (mouse, keyboard, scroll, touch timing and geometry), runs
headless and anti-detect checks, sends them to your AEGIS server, and adds
the returned token to your site's requests. On a 403 challenge it solves a
memory-hard proof of work (scrypt in WebAssembly) and retries.

It never sends key contents, typed text, URLs or the raw user agent; the
device fingerprint is sent only as a SHA-256 hash.

Script tag (`dist/aegis.min.js`, global `Aegis`), served from your own site:

```html
<script src="/static/aegis.min.js" data-site-key="my-site"></script>
```

As a module:

```js
import { AegisClient } from '@aegis/js-sdk';
const aegis = new AegisClient({ siteKey: 'my-site' });
const token = await aegis.getToken();
```

It needs a server running the AEGIS middleware:
[`@aegis/server-node`](https://www.npmjs.com/package/@aegis/server-node) or the
Python package `aegis-server-python`.

- Options: [configuration.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/configuration.md#browser-sdk-aegisjs-sdk)
- API: [API_REFERENCE.md](https://github.com/dipro20debnath/AEGIS-BOT-SHIELD/blob/main/docs/API_REFERENCE.md#browser-sdk-aegisjs-sdk)

MIT licence.
