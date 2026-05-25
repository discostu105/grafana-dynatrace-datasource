// Post-process log frames: for each configured derived field rule, scan the
// `body` field's values, run the regex, and add a new field carrying the
// captured value with a DataLink (clickable button) pointing at the URL
// template. Matches the pattern grafana-loki-datasource uses.

import { DataFrame, DataLink, Field, FieldType, MutableDataFrame } from '@grafana/data';
import { DerivedField } from './types';

const LOGS_VIS = 'logs';

export function applyDerivedFields(frames: DataFrame[], rules?: DerivedField[]): DataFrame[] {
  if (!frames?.length || !rules?.length) {
    return frames;
  }
  return frames.map((f) => maybeEnhance(f, rules));
}

function maybeEnhance(frame: DataFrame, rules: DerivedField[]): DataFrame {
  if (frame.meta?.preferredVisualisationType !== LOGS_VIS) {
    return frame;
  }
  const bodyField = frame.fields.find((x) => x.name === 'body' || x.name === 'content' || x.name === 'message');
  if (!bodyField) {
    return frame;
  }
  // Compile rules once per frame.
  const compiled = rules
    .map((r) => {
      try {
        return { rule: r, re: new RegExp(r.matcherRegex) };
      } catch {
        return null;
      }
    })
    .filter((x): x is { rule: DerivedField; re: RegExp } => x !== null);

  if (!compiled.length) {
    return frame;
  }

  const len = bodyField.values?.length ?? 0;
  const extracted: Record<string, Array<string | null>> = {};
  for (const { rule } of compiled) {
    extracted[rule.name] = new Array(len).fill(null);
  }

  for (let i = 0; i < len; i++) {
    const raw = bodyField.values?.get ? bodyField.values.get(i) : (bodyField.values as unknown[])?.[i];
    const body = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
    if (!body) {
      continue;
    }
    for (const { rule, re } of compiled) {
      const m = body.match(re);
      if (!m) {
        continue;
      }
      extracted[rule.name][i] = m[1] ?? m[0];
    }
  }

  const out = new MutableDataFrame(frame);
  for (const { rule } of compiled) {
    const values = extracted[rule.name];
    if (!values.some((v) => v !== null)) {
      continue; // no matches in this frame; don't add an empty column
    }
    const link: DataLink = {
      title: rule.urlDisplayLabel || rule.name,
      url: rule.url,
      targetBlank: !rule.datasourceUid,
    };
    if (rule.datasourceUid) {
      // datasourceName isn't known at config-edit time; Grafana resolves
      // it from the uid at link-render time. Cast through unknown because
      // the upstream `InternalDataLink` type requires `datasourceName`
      // which we can't fill in.
      (link as unknown as { internal?: unknown }).internal = {
        datasourceUid: rule.datasourceUid,
        query: { dqlQuery: rule.url },
      };
    }
    const f: Field = {
      name: rule.name,
      type: FieldType.string,
      config: { links: [link] },
      values: values as unknown as Field['values'],
    };
    out.addField(f);
  }
  return out;
}
