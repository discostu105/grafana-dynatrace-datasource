// Pure DQL generator for the visual query builder.
//
// One-way: BuilderState → DQL string. We don't try to parse arbitrary
// hand-written DQL back into a BuilderState — switching code→builder
// in the editor warns before overwriting unsaved manual edits.

import type {
  BuilderAggFn,
  BuilderBucket,
  BuilderFilter,
  BuilderOperator,
  BuilderSource,
  BuilderState,
} from './types';

export const DEFAULT_BUILDER: BuilderState = {
  source: 'logs',
  filters: [],
  groupBy: [],
  aggregation: { fn: 'count' },
  bucket: 'auto',
};

export const BUILDER_SOURCES: BuilderSource[] = [
  'logs',
  'events',
  'spans',
  'metric.series',
  'dt.entity.host',
  'dt.entity.service',
];

export const BUILDER_OPERATORS: BuilderOperator[] = ['==', '!=', 'contains', 'matches'];

export const BUILDER_AGG_FNS: BuilderAggFn[] = ['count', 'avg', 'sum', 'min', 'max', 'median'];

export const BUILDER_BUCKETS: BuilderBucket[] = ['auto', '1m', '5m', '15m', '1h'];

/**
 * dqlFromBuilder produces the DQL string corresponding to a BuilderState.
 * Pure function — same input → same output.
 *
 * Strategy: filter out incomplete rows (empty field / value), pick the
 * shape based on whether we're aggregating, and concatenate pipeline
 * stages with one stage per line.
 */
export function dqlFromBuilder(b: BuilderState): string {
  const filters = b.filters.filter((f) => f.field?.trim() && f.value?.trim());
  const groupBy = b.groupBy.filter(Boolean);
  const lines: string[] = [`fetch ${b.source}`];
  if (filters.length) {
    lines.push(`| filter ${filters.map(formatFilter).join(' AND ')}`);
  }

  const isCount = b.aggregation.fn === 'count';
  const aggExpr = isCount
    ? 'count()'
    : `${b.aggregation.fn}(${b.aggregation.field?.trim() || 'value'})`;

  if (groupBy.length || !isCount) {
    // Need a summarize stage. If a time bucket is requested, add it as
    // a `by:{bin(timestamp, …)}` group (DQL timeseries-style aggregation
    // from a `fetch` stream).
    const byParts = [...groupBy];
    if (b.bucket && b.bucket !== 'auto') {
      byParts.unshift(`bin(timestamp, ${b.bucket})`);
    } else if (b.bucket === 'auto') {
      byParts.unshift('bin(timestamp, $__interval)');
    }
    lines.push(`| summarize cnt = ${aggExpr}, by:{${byParts.join(', ')}}`);
  } else {
    // Plain count, no grouping → single scalar.
    lines.push('| summarize cnt = count()');
  }
  return lines.join('\n');
}

function formatFilter(f: BuilderFilter): string {
  const v = f.value.trim();
  switch (f.operator) {
    case '!=':
      return `${f.field} != "${escapeDQL(v)}"`;
    case 'contains':
      return `contains(${f.field}, "${escapeDQL(v)}")`;
    case 'matches':
      return `matchesValue(${f.field}, "${escapeDQL(v)}")`;
    case '==':
    default:
      return `${f.field} == "${escapeDQL(v)}"`;
  }
}

function escapeDQL(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
