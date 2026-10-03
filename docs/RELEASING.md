# Releasing

Nothing has been published yet. This is the procedure for when it is
(planned with v1.0.0, Phase F). Publishing needs the maintainer's own npm
and PyPI accounts; it cannot be done from CI without them.

## What gets published

| Registry | Package | From | Name status (checked 2026-10-03) |
|---|---|---|---|
| npm | `@aegis/core` | `packages/core` | unused, but the **`@aegis` scope must be an npm organisation you own**; if you cannot create it, rename the scope (e.g. `@aegis-bot-shield/…`) in all three `package.json` files, the server-node dependency and the docs |
| npm | `@aegis/server-node` | `packages/server-node` | as above |
| npm | `@aegis/js-sdk` | `packages/js-sdk` | as above |
| PyPI | `aegis-server-python` | `packages/server-python` | free |
| PyPI | `aegis-ml-engine` | `packages/ml-engine` | free |

Not published: `@aegis/dashboard` and `@aegis/edge-cloudflare` (`private`;
deploy them instead), the root workspace.

## Before a release

```bash
npm ci && npm run build
npm test && npm run lint
python -m pytest packages/ml-engine/tests packages/server-python/tests
npm run test:e2e
pip install build twine
npm run release:check          # tarball contents, metadata, sdist/wheel + twine check; publishes nothing
```

1. Set the same version in the three npm `package.json` files, both
   `pyproject.toml` files, `aegis_shield/__init__.py` (`__version__`) and the
   OpenAPI `info.version` (`contracts/openapi.json`, then `npm run sync:openapi`).
2. Update `CHANGELOG.md`.
3. Merge to `main` with green CI.

## Publish

```bash
# npm (2FA on): core first, server-node depends on it
npm login
npm publish -w @aegis/core
npm publish -w @aegis/server-node
npm publish -w @aegis/js-sdk

# PyPI: prefer an API token scoped to the project, or Trusted Publishing from GitHub Actions
python -m build packages/server-python --outdir dist/
python -m build packages/ml-engine --outdir dist/
python -m twine upload dist/*

git tag v1.0.0 && git push origin v1.0.0
```

`prepublishOnly` in each npm package cleans, builds and runs its tests, so a
broken build cannot be published from a stale `dist/`.

## After

- Create the GitHub release from the tag with the changelog section.
- Check the package pages render the READMEs (links are absolute GitHub URLs
  on purpose).
- Install from the registries into an empty project and run the getting-started
  example once.
