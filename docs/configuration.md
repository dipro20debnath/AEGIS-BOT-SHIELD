# Configuration

The AEGIS middleware can be configured with the following options:

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | String | `null` | **Required.** Your AEGIS API key. |
| `mode` | String | `'monitor'` | Protection mode: `'monitor'`, `'enforce'`, or `'strict'`. |
| `rateLimit` | Object | `{ windowMs: 60000, max: 100 }` | Rate limiting configuration. |
| `allowlist` | Array<String> | `[]` | List of IPs or CIDRs to bypass protection. |
| `blocklist` | Array<String> | `[]` | List of IPs or CIDRs to always block. |
| `challengeType` | String | `'silent'` | The type of challenge to issue: `'silent'`, `'captcha'`, `'block'`. |
