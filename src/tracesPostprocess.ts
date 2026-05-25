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

function decodeTagsField(frame: DataFrame): DataFrame {
  const tagsIdx = frame.fields.findIndex((f) => f.name === 'tags');
  if (tagsIdx < 0) {
    return frame;
  }
  const tagsField = frame.fields[tagsIdx];
  const raw = tagsField.values;
  const n = raw?.length ?? 0;

  const decoded: Array<Array<{ key: string; value: unknown }>> = new Array(n);
  for (let i = 0; i < n; i++) {
    const cell = raw?.get ? raw.get(i) : (raw as unknown[])?.[i];
    decoded[i] = parseTagsCell(cell);
  }

  // MutableDataFrame lets us swap a field at a fixed index; we replicate
  // the input frame and then overwrite the tags column with the parsed
  // values (typed as `other` so Grafana's serializer treats them as
  // structured payloads rather than strings).
  const out = new MutableDataFrame({
    ...frame,
    fields: frame.fields.map((f, i) =>
      i === tagsIdx
        ? {
            name: 'tags',
            type: FieldType.other,
            config: f.config ?? {},
            values: decoded as unknown as typeof f.values,
          }
        : f
    ),
  });
  return out;
}

function parseTagsCell(cell: unknown): Array<{ key: string; value: unknown }> {
  if (Array.isArray(cell)) {
    // Already decoded — happens when the response went through a panel that
    // pre-parsed it. Pass through.
    return cell as Array<{ key: string; value: unknown }>;
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
