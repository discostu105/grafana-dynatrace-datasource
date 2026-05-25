// Post-process trace frames so Grafana's traces panel doesn't choke.
//
// Three things happen here:
//
//   1. For trace-detail frames (Meta.PreferredVisualisation=trace, has
//      span.id-bearing rows): decode the JSON-encoded array columns
//      `tags` / `serviceTags` / `logs` / `references` into real JS
//      arrays. The panel calls .map / .reduce / .forEach on them.
//
//   2. For trace-list frames (queryType=traces but rollup shape — no
//      span.id, has trace.id): rename trace.id → traceID and attach
//      an internal DataLink on the traceID column so clicking a row
//      opens the trace-detail view in a new Explore pane.
//
// We mutate the existing frame in place: field.values gets replaced,
// field.name/type/config updated. That's simpler and more robust than
// reconstructing the frame via MutableDataFrame.

import { DataFrame, DataLink, Field, FieldType } from '@grafana/data';
import type { DqlQuery } from './types';

const TRACE_VIS = 'trace';
const ARRAY_FIELDS = new Set(['tags', 'serviceTags', 'logs', 'references']);

export function decodeTraceFrames(frames: DataFrame[]): DataFrame[] {
  if (!frames?.length) {
    return frames;
  }
  for (const frame of frames) {
    if (frame.meta?.preferredVisualisationType !== TRACE_VIS) {
      continue;
    }
    decodeArrayFieldsInPlace(frame);
  }
  return frames;
}

// enhanceTraceListFrames is for frames from queryType=traces queries that
// came back as plain tables (no span.id in the records → rollup shape).
// We rename trace.id → traceID and attach a Grafana internal DataLink so
// each row's trace ID is clickable, opening Explore with a span-detail
// query against the same datasource.
//
// Caller supplies `datasourceUid` because internal links need it baked
// into the link config (the backend doesn't know its own uid).
export function enhanceTraceListFrames(
  frames: DataFrame[],
  datasourceUid: string,
  queryByRefId: Map<string, DqlQuery>
): DataFrame[] {
  if (!frames?.length) {
    return frames;
  }
  for (const frame of frames) {
    const q = queryByRefId.get(frame.refId ?? '');
    if (q?.queryType !== 'traces') {
      continue;
    }
    if (frame.meta?.preferredVisualisationType === TRACE_VIS) {
      // already a detail frame — skip
      continue;
    }
    enhanceListFrameInPlace(frame, datasourceUid);
  }
  return frames;
}

function enhanceListFrameInPlace(frame: DataFrame, datasourceUid: string): void {
  const f = frame.fields.find((x) => x.name === 'trace.id' || x.name === 'traceID');
  if (!f) {
    return;
  }
  // Standardise to traceID (the column name Grafana's table panel
  // gives special treatment to).
  (f as unknown as { name: string }).name = 'traceID';
  const link: DataLink = {
    title: 'View trace',
    url: '',
    targetBlank: false,
  };
  // Internal-link variant — opens Explore against this datasource with
  // a span-detail query. Grafana resolves ${__value.raw} to the cell
  // value at click time.
  (link as unknown as { internal?: unknown }).internal = {
    datasourceUid,
    query: {
      dqlQuery: 'fetch spans | filter trace.id == "${__value.raw}" | sort start_time',
      queryType: 'traces',
    },
  };
  if (!f.config) {
    (f as unknown as { config: { links?: DataLink[] } }).config = { links: [link] };
  } else {
    f.config.links = [...(f.config.links ?? []), link];
  }
}

function decodeArrayFieldsInPlace(frame: DataFrame): void {
  for (const f of frame.fields) {
    if (!ARRAY_FIELDS.has(f.name)) {
      continue;
    }
    const n = f.values?.length ?? 0;
    const decoded: unknown[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const cell = readCell(f, i);
      decoded[i] = parseArrayCell(cell);
    }
    // Direct in-place mutation. The Vector / array on the values field
    // is swapped out, the type is updated. Grafana's frame model is
    // structural — no internal indexes to rebuild.
    (f as unknown as { values: unknown[] }).values = decoded;
    (f as unknown as { type: FieldType }).type = FieldType.other;
  }
}

function readCell(field: Field, i: number): unknown {
  const v = field.values as { get?: (i: number) => unknown } | unknown[] | undefined;
  if (v && typeof (v as { get?: unknown }).get === 'function') {
    return (v as { get: (i: number) => unknown }).get(i);
  }
  return (v as unknown[] | undefined)?.[i];
}

function parseArrayCell(cell: unknown): unknown[] {
  if (Array.isArray(cell)) {
    return cell;
  }
  if (typeof cell !== 'string' || !cell) {
    return [];
  }
  try {
    const parsed = JSON.parse(cell);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
