// Post-process trace frames: the backend emits `tags` as a JSON-encoded
// string per row, but Grafana's traces visualisation calls `.reduce()` on
// it — so the value needs to be an actual array. Parse on the way through
// the response Observable.
//
// Same pattern grafana-tempo-datasource uses: the backend ships the wire
// format that's cheapest to produce; the frontend rebuilds the rich
// JS-side shape the panel expects.

import { DataFrame, FieldType, MutableDataFrame } from '@grafana/data';

const TRACE_VIS = 'trace';

export function decodeTraceFrames(frames: DataFrame[]): DataFrame[] {
  if (!frames?.length) {
    return frames;
  }
  // Debug breadcrumb (visible in browser console when troubleshooting the
  // traces view) — costs nothing in steady state.
  const traceCount = frames.filter((f) => f.meta?.preferredVisualisationType === TRACE_VIS).length;
  if (traceCount) {
    // eslint-disable-next-line no-console
    console.debug('[dql] decodeTraceFrames: processing', traceCount, 'of', frames.length, 'frames');
  }
  return frames.map((f) => {
    if (f.meta?.preferredVisualisationType !== TRACE_VIS) {
      return f;
    }
    return decodeTagsField(f);
  });
}

// Fields Grafana's traces panel expects as actual JS arrays of
// {key, value} (or similar). The backend ships them as JSON-encoded
// strings to keep the wire format simple; we decode here so the panel
// can walk them without choking.
const ARRAY_FIELDS = new Set(['tags', 'serviceTags', 'logs', 'references']);

function decodeTagsField(frame: DataFrame): DataFrame {
  const fieldsToDecode = frame.fields.map((f, i) => (ARRAY_FIELDS.has(f.name) ? i : -1)).filter((i) => i >= 0);
  if (!fieldsToDecode.length) {
    return frame;
  }
  const decodedByIdx = new Map<number, unknown[]>();
  for (const idx of fieldsToDecode) {
    const fld = frame.fields[idx];
    const raw = fld.values;
    const n = raw?.length ?? 0;
    const out: unknown[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const cell = raw?.get ? raw.get(i) : (raw as unknown[])?.[i];
      out[i] = parseArrayCell(cell);
    }
    decodedByIdx.set(idx, out);
  }
  // MutableDataFrame lets us swap fields at fixed indexes; replicate the
  // input frame and overwrite the JSON-encoded columns with the parsed
  // values (typed as `other` so Grafana treats them as structured
  // payloads rather than strings).
  return new MutableDataFrame({
    ...frame,
    fields: frame.fields.map((f, i) =>
      decodedByIdx.has(i)
        ? {
            name: f.name,
            type: FieldType.other,
            config: f.config ?? {},
            values: decodedByIdx.get(i) as unknown as typeof f.values,
          }
        : f
    ),
  });
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
