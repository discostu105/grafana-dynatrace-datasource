# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Lifted shared test selectors into `src/selectors.ts` so Playwright specs and
  components agree on a single source of truth for label/aria text.
- Consolidated the Grail autocomplete proxy call onto the `DataSource` class;
  the Monaco language registration calls `datasource.autocomplete(...)` instead
  of constructing the resource URL itself.
- Replaced the deprecated `HorizontalGroup` in `QueryEditor` with `Stack`.
- Tightened `applyTemplateVariables` / ad-hoc collection to use typed Grafana
  variable models instead of `any` casts.
- Expanded the Go lint set (govet, staticcheck, ineffassign, unused, gocritic,
  misspell, unconvert) and added a drift check that fails the backend tests if
  `pluginVersion` falls out of sync with `package.json`.

## [1.0.0] - Initial release

- Per-instance config (tenant URL + SecureJSON token, query timeout, default
  timeframe).
- Server-side macro expansion: `$__timeFrom/To/from/to/interval/timeFilter`.
- Timeseries + table + logs result shapes; unit + display-name field config
  derived from Grail labels.
- Alerting and annotations support.
- Variable queries (`metricFindQuery`) and dashboard ad-hoc filters with
  Grail-backed key/value discovery.
- Monaco DQL editor with autocomplete proxied through the plugin backend.
- Backend retry with concurrency cap.
