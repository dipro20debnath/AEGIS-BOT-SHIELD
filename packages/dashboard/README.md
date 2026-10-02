# AEGIS Dashboard

React + Vite admin dashboard. Every number comes from a running AEGIS server's
status API (`/aegis/stats`, `/aegis/events`, `/aegis/config`, `/aegis/health`,
see `packages/server-node/src/routes.ts`) or, for the ML Engine page, from the
experiment output `docs/thesis/results/synthetic/results.json` bundled at build
time. When the server is unreachable the pages say so instead of showing data.

```bash
node examples/express-integration/server.js          # AEGIS server on :3000
AEGIS_API=http://localhost:3000 npm run dev -w packages/dashboard
npm run build -w packages/dashboard                   # dist/
```

The status API describes your traffic: serve it only to administrators.
