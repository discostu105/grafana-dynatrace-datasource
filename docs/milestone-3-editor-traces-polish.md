# Milestone 3 — Editor, traces, and polish

## Goal

After Milestones 1 and 2 the plugin is correct, configurable, and integrated
with Grafana's logs / alerting / annotations / variables. What still separates
it from a mature, public-catalog-quality data source is **authoring experience**
and **trace data**:

- The query editor is a plain textarea — no syntax highlighting, no
  autocomplete, no formatting, no error markers, no run shortcut.
- DQL has a richer surface (`fetch spans`, `smartscapeNodes`) than the
  current frame mapper exposes; in particular, distributed traces are
  not surfaced as Grafana traces.
- Operational polish (request tracing, retry, rate limiting, branding,
  catalog readiness) is missing.

This milestone takes the plugin from "fully functional internal tool" to
"shippable in the public plugin catalog".

## Prerequisites

- Milestones 1 and 2 complete.

## Out of scope

- Profiling support (not currently a DQL primary).
- Built-in DQL formatter / linter as a public API (we ship a basic
  implementation but do not promise stability).

## Requirements

### R3.1 — Monaco-based DQL editor

- Replace the `<textarea>` in `QueryEditor.tsx` with a Monaco editor (use
  `@grafana/ui`'s `CodeEditor` so we inherit theme + sizing).
- Define a DQL language contribution:
  - **Tokenizer** covering DQL verbs (`fetch`, `filter`, `summarize`,
    `fields…`, `parse`, `join`, `lookup`, `timeseries`, `makeTimeseries`,
    `sort`, `limit`), operators, string/number/duration literals, and
    comments.
  - Bracket matching, auto-closing pairs for `(`, `[`, `{`, `"`, `'`.
  - A monarch language id `dql` registered globally so other contexts
    (alert rule editor) get the same highlighting.
- Editor toolbar with: format selector (timeseries / table / logs / trace),
  "Run query" button, "Format DQL" button (best-effort indenter), and a
  link to the DQL reference docs.
- Keyboard: `Ctrl/Cmd + Enter` runs the query; `Shift + Alt + F` formats.

### R3.2 — Autocomplete and inline schema discovery

- Register a Monaco completion provider that suggests:
  - DQL verbs / keywords (static list).
  - Field names observed in the **last successful response** for the same
    refId (cached client-side per editor instance).
  - Dimensions and metrics from a backend "list keys" call. Add a Go
    resource handler `GET /resources/keys?prefix=…` that runs a DQL probe
    (`fetch metric.series | summarize by:{metric.key} | limit 200` or
    similar) and returns matches.
  - Template variables (`$varname`) from `templateSrv.getVariables()`.
- Trigger characters: `.`, `:`, `,`, space after a pipe.
- Each completion item carries a documentation snippet (kept in a static
  `dqlDocs.ts` file) so users see "what this verb does" inline.

### R3.3 — Traces support

- Set `"tracing": true` in `plugin.json` (we'll already have stubbed it in
  M2; this milestone makes it real).
- Add `queryType: 'traces'` to the query model. Two sub-modes:
  - **Trace list** — `fetch spans | summarize by:{trace.id}` style; renders
    as a table of trace IDs with duration, service, root operation. Each
    row links to a trace detail.
  - **Trace detail** — `fetch spans | filter trace.id == "<id>"`; mapped
    to a Grafana traces frame (`Meta.PreferredVisualisation =
data.VisTypeTrace`) with the OpenTelemetry-compatible field set
    (`traceID`, `spanID`, `parentSpanID`, `operationName`, `serviceName`,
    `startTime`, `duration`, `tags`, `logs`).
- Backend mapper `pkg/plugin/traces.go` produces the frame; unit tests
  cover a small captured span response.

### R3.4 — Trace-to-logs / trace-to-metrics links

- In `ConfigEditor`, add the standard "Trace to logs" and "Trace to
  metrics" sections (mirror the contract used by other Grafana trace
  data sources):
  - Target data source picker.
  - Tag mapping (span tag → log/metric label).
  - Query template (DQL with `${__span.traceId}` placeholder).
- Persist these in `jsonData.tracesToLogs` and `jsonData.tracesToMetrics`;
  the frontend passes them to the traces view via frame `Meta.Custom`.

### R3.5 — Visual query builder (basic)

- Behind a "Builder / Code" toggle (matching the pattern other SQL-ish
  data sources use), expose a form-based builder for the most common
  shape:
  - Data source: dropdown (`metrics`, `logs`, `events`, `spans`,
    `smartscapeNodes "HOST"` / `"SERVICE"`).
  - Filters: repeatable `field` `operator` `value` rows.
  - Group by: multi-select of dimensions discovered via R3.2.
  - Aggregation: `count` / `avg` / `sum` / `min` / `max` plus the field
    they operate on.
  - Time bucketing: dropdown (`auto`, `1m`, `5m`, `1h`).
- The builder is a one-way generator: each change rewrites the DQL in the
  Monaco editor. Switching back to code mode keeps user edits; switching
  to builder mode after manual edits warns "this will overwrite your
  query".
- Builder is optional UX; advanced users live in code mode. The builder
  does not need to handle every DQL feature — explicitly link to code
  mode for `join`, `lookup`, `parse`, etc.

### R3.6 — Result field configuration

- Map richer Grail metadata onto Grafana field config:
  - Decimal places from the column's declared precision.
  - Min / max from metadata when present (drives gauges).
  - Display name templating from group-by dimensions (e.g.
    `{{dt.smartscape.host}}`).
- Add a per-query "Series naming" input (templated string) that overrides
  the default legend, mirroring the experience of mature data sources.

### R3.7 — Resilience and observability

- Wrap Grail calls with:
  - Retry with exponential backoff on `429` and `5xx`, max 3 attempts,
    honoring `Retry-After`.
  - Per-instance concurrency limit (configurable, default 8) to avoid
    saturating the Grail query budget.
  - Context cancellation: if the Grafana request context is cancelled,
    propagate to the Grail poll and surface a "query cancelled" notice
    instead of an opaque error.
- Add structured logging at info level for each query (refId, DQL length,
  duration, row count) and at debug for the raw shape (existing behavior).
- Export Prometheus metrics from the backend via the Grafana plugin SDK:
  request count, request duration histogram, error count by status code.

### R3.8 — Catalog readiness

- Real branding: SVG logo (not the scaffold default), 1280×640 cover
  image, three screenshots in `src/img/`.
- `plugin.json` polished:
  - `info.description` — one sentence pitched at a Grafana admin.
  - `info.keywords` — actual keywords (`dql`, `observability`,
    `metrics`, `logs`, `traces`).
  - `info.links` — homepage, docs, issue tracker.
  - `info.screenshots` — populated.
- README expanded with a feature matrix, a DQL primer for users coming
  from PromQL / SQL, and a troubleshooting section.
- `CHANGELOG.md` is current and follows Keep-a-Changelog format.
- Plugin signs and passes `npx @grafana/plugin-validator` cleanly.

### R3.9 — Test coverage

- Backend ≥ 80% line coverage on `pkg/plugin/` (frames, traces, macros).
- Frontend unit tests for: the Monaco language contribution (tokenizer
  golden tests), the completion provider, the builder→DQL generator.
- E2E specs added for: traces view, trace-to-logs link, autocomplete in
  the editor, builder mode round-trip.

## Definition of done

- A new user, with no prior DQL knowledge, can type a query in the
  builder, switch to code mode to refine it, and ship it to a dashboard
  in under 5 minutes.
- A trace ID followed from a logs panel opens a full waterfall in the
  traces view.
- `npx @grafana/plugin-validator` reports zero errors and zero warnings.
- The plugin is submitted to the Grafana catalog and accepted on first
  review (no missing-asset or missing-doc rejections).

## Status (2026-05-25)

| Req  | Status      | Notes                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3.1 | ⚠️ Partial   | `@grafana/ui` `CodeEditor` replaces the textarea (`QueryEditor.tsx`). DQL Monaco language is registered globally via `dql/language.ts` — tokenizer covers verbs, operators, strings, numbers, durations, comments; bracket pairs + auto-closing wired up. `Ctrl/Cmd + Enter` runs the query. Missing: dedicated **Format DQL** button and `Shift + Alt + F` binding, format selector dropdown, docs-link button. |
| R3.2 | ✅ Done     | Monaco completion provider in `dql/language.ts` calls `datasource.autocomplete(...)`, which hits the backend resource handler `POST /resources/autocomplete` (proxies Grail's `/query:autocomplete`). Static keyword fallback on error. Trigger chars include `.`, `:`, `,`, space, `|`, `{`, `$`. Documentation strings come from Grail's `parts[].info`.                                                       |
| R3.3 | ✅ Done     | `"tracing": true` in `plugin.json`. `queryType: 'traces'` selector. `isTraceDetailShape` switches between trace-list (regular table mapper + clickable `traceID` link stamped by `enhanceTraceListFrames`) and trace-detail (`recordsToTraceFrame` emits `VisTypeTrace` with OTel-compatible field set including `kind`, `statusCode`, `tags`). `traces_test.go` covers the mapper.                              |
| R3.4 | ✅ Done     | `TracesCorrelationEditor.tsx` exposes Trace-to-logs and Trace-to-metrics sections; persisted in `jsonData.tracesToLogs` / `jsonData.tracesToMetrics`; `stampTraceCorrelations` writes them into the trace frame's `Meta.Custom` for the traces panel.                                                                                                                                                            |
| R3.5 | ✅ Done     | `BuilderEditor.tsx` + `builder.ts` implement the Builder ↔ Code toggle with `ConfirmModal` warning when hand-written DQL would be overwritten. Source dropdown is now populated live from `fetch dt.system.data_objects` (cached for an hour); filters, group-by, aggregation incl. percentile, time bucketing all wired up. Generator covered by `builder.test.ts`.                                            |
| R3.6 | ✅ Done     | `inferDecimals` / `inferMinMax` in `pkg/plugin/fieldconfig.go` derive decimals + min/max from unit + observed values. `applyFieldConfig` sets `DisplayNameFromDS` from labels. Per-query "Series naming" template via `legendFormat` (`{{ control.name }}`) input in `QueryEditor.tsx`, applied by `applyLegendFormat`.                                                                                          |
| R3.7 | ✅ Done     | `pkg/dynatrace/retry.go` does exponential backoff on 429/5xx (max 3 attempts, honors `Retry-After`). `client.go` enforces a per-instance concurrency cap (default 8, semaphore-based). Context cancellation propagates through `Query`. Structured `log.DefaultLogger.Info` per query (refID, queryType, rows, frames, duration). `pkg/plugin/metrics.go` exports Prometheus counters/histograms.               |
| R3.8 | ⚠️ Partial   | `plugin.json` `info.description`, `info.keywords`, `info.links` all populated. **Gaps:** `info.screenshots` is `[]`; `src/img/` only contains the scaffold-style `logo.svg` — no production-quality logo, no 1280×640 cover image, no three numbered screenshots. README has the feature matrix and DQL examples but no DQL-vs-PromQL/SQL primer or troubleshooting section. `npx @grafana/plugin-validator` not run/recorded. |
| R3.9 | ⚠️ Partial   | Backend has `frames_test.go`, `logs_test.go`, `traces_test.go`, `fieldconfig_test.go`, `adhoc_test.go`, `dataobjects_test.go`, `version_test.go`, plus retry tests under `pkg/dynatrace/`. Frontend has `builder.test.ts`, `derivedFields.test.ts`, `logsHooks.test.ts`, `tracesPostprocess*.test.ts`. **Missing:** Monaco language tokenizer golden tests, completion-provider tests, and the e2e specs for traces / trace-to-logs link / autocomplete / builder round-trip. Coverage gate (≥ 80% backend) not enforced in CI. |

**Overall:** Milestone 3 mostly delivered. Remaining work: editor formatter/toolbar polish (R3.1), catalog assets + plugin-validator pass (R3.8), and broader test coverage / e2e specs (R3.9).
