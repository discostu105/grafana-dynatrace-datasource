# Contributing

Thanks for your interest in improving the Dynatrace Grail data source for
Grafana. This document covers how to get a development environment running and
what we expect from a pull request.

## Prerequisites

- **Node.js >= 22** (see `.nvmrc`)
- **Go** (version pinned in `go.mod`)
- **[Mage](https://magefile.org/)** for backend builds
- **Docker** (optional) for the local Grafana dev server and e2e tests

## Getting started

```bash
npm install            # install frontend dependencies
npm run dev            # webpack watch (frontend)
mage -v buildAll       # build the backend for all architectures
npm run server         # docker compose: Grafana + this plugin
```

The dev datasource reads `DT_TENANT_URL` and `DT_TOKEN` from the environment
(see `provisioning/datasources/datasources.yml`). Export them before
`npm run server`.

## Checks to run before opening a PR

CI runs all of these; running them locally keeps the feedback loop fast.

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run prettier:check   # formatting (run `npm run lint:fix` to auto-fix)
npm run test:ci          # frontend unit tests
go test ./...            # backend unit tests
mage buildAll            # backend build
npm run build            # frontend build
npm run e2e              # Playwright end-to-end tests (needs Grafana running)
```

## Pull request guidelines

- Keep changes focused; one logical change per PR.
- Add or update tests for behavior changes (`pkg/**/*_test.go`,
  `src/**/*.test.ts`, `tests/*.spec.ts`).
- Update `CHANGELOG.md` under the `[Unreleased]` heading.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit
  messages (e.g. `feat(builder): ...`, `fix(macros): ...`).
- **Do not modify anything inside `.config/`** — it is managed by the Grafana
  plugin tooling.
- **Do not change the plugin ID or type** in `src/plugin.json`.
- When bumping the version, update **both** `package.json` and the
  `pluginVersion` constant in `pkg/plugin/datasource.go`. A drift check in the
  backend tests fails if they disagree.

## Reporting bugs / requesting features

Use the [issue tracker](https://github.com/discostu105/grafana-dynatrace-datasource/issues)
and the provided templates. For security issues, see [SECURITY.md](SECURITY.md).
