// Pure helpers backing the logs-related DataSource methods. Extracted from
// DataSource so they're testable without mocking the @grafana/runtime
// backend service.

import { LogRowContextOptions, LogRowContextQueryDirection, LogRowModel, SupplementaryQueryType } from '@grafana/data';
import type { DqlQuery } from './types';

// Labels that come from the severity column — excluded from log-context
// selectors so a single "warning" log doesn't constrain the surrounding
// query to only other warnings.
const SEVERITY_LABEL_KEYS = new Set(['level', 'loglevel', 'severity']);

/**
 * Wrap the user's logs DQL with a `summarize count(), by:{bin(timestamp,
 * $__interval), severity}` so the result is a timeseries grouped by level —
 * what Grafana renders as the log volume histogram bars above the panel.
 *
 * Returns undefined when the input doesn't qualify (non-logs query, missing
 * DQL, or wrong supplementary type).
 */
export function buildLogsVolumeQuery(type: SupplementaryQueryType, query: DqlQuery): DqlQuery | undefined {
  if (type !== SupplementaryQueryType.LogsVolume) {
    return undefined;
  }
  if (query.queryType !== 'logs' || !query.dqlQuery) {
    return undefined;
  }
  const wrapped = `${query.dqlQuery.trim()}
| summarize count = count(), by:{interval = bin(timestamp, $__interval), severity = if(isNotNull(loglevel), loglevel, else: "unknown")}`;
  return {
    ...query,
    refId: `${query.refId}-volume`,
    dqlQuery: wrapped,
    queryType: 'timeseries',
  };
}

/**
 * Build the DQL for "show context" — fetch rows around a clicked log row by
 * reusing the row's non-severity labels as a stable filter.
 *
 * Returns the DQL string and a +/- window around the row timestamp (in ms)
 * so the caller can build a TimeRange for the request.
 */
export function buildLogContextDQL(
  row: LogRowModel,
  options?: LogRowContextOptions
): {
  dql: string;
  fromMs: number;
  toMs: number;
} {
  const limit = options?.limit ?? 50;
  const direction = options?.direction === LogRowContextQueryDirection.Forward ? 'asc' : 'desc';
  const cmp = direction === 'asc' ? '>=' : '<=';
  const labels = row.labels ?? {};
  const selectorParts = Object.entries(labels)
    .filter(([k]) => k && !SEVERITY_LABEL_KEYS.has(k))
    .map(([k, v]) => `${k} == "${String(v).replace(/"/g, '\\"')}"`);
  const labelFilter = selectorParts.length ? selectorParts.join(' AND ') : 'true';
  const ts = row.timeEpochMs;
  const dql =
    `fetch logs | filter ${labelFilter} ` +
    `| filter timestamp ${cmp} fromUnixMillis(${ts}) ` +
    `| sort timestamp ${direction} | limit ${limit}`;
  // 1-hour window each side keeps the Grail scan bounded.
  return { dql, fromMs: ts - 60 * 60 * 1000, toMs: ts + 60 * 60 * 1000 };
}
