import { MutableDataFrame, FieldType } from '@grafana/data';
import { decodeTraceFrames } from './tracesPostprocess';

function traceFrame(tags: Array<string | null>) {
  return new MutableDataFrame({
    refId: 'A',
    meta: { preferredVisualisationType: 'trace' },
    fields: [
      { name: 'traceID', type: FieldType.string, values: tags.map((_, i) => `t${i}`) },
      { name: 'spanID', type: FieldType.string, values: tags.map((_, i) => `s${i}`) },
      { name: 'tags', type: FieldType.string, values: tags },
    ],
  });
}

describe('decodeTraceFrames', () => {
  it('parses JSON-encoded tag strings into arrays', () => {
    const f = traceFrame(['[{"key":"host","value":"h1"}]', '[{"key":"foo","value":"bar"}]']);
    const out = decodeTraceFrames([f])[0];
    const tags = out.fields.find((x) => x.name === 'tags')!;
    expect(tags.type).toBe(FieldType.other);
    const v0 = tags.values.get ? tags.values.get(0) : (tags.values as any)[0];
    expect(v0).toEqual([{ key: 'host', value: 'h1' }]);
  });

  it('treats invalid JSON as empty array (never throws)', () => {
    const f = traceFrame(['not json', null, '']);
    const out = decodeTraceFrames([f])[0];
    const tags = out.fields.find((x) => x.name === 'tags')!;
    const v = (i: number) => (tags.values.get ? tags.values.get(i) : (tags.values as any)[i]);
    expect(v(0)).toEqual([]);
    expect(v(1)).toEqual([]);
    expect(v(2)).toEqual([]);
  });

  it('passes non-trace frames through unchanged', () => {
    const f = new MutableDataFrame({
      refId: 'A',
      meta: { preferredVisualisationType: 'graph' as any },
      fields: [{ name: 'tags', type: FieldType.string, values: ['x'] }],
    });
    const out = decodeTraceFrames([f]);
    expect(out[0]).toBe(f);
  });

  it('is a no-op for frames without a tags column', () => {
    const f = new MutableDataFrame({
      refId: 'A',
      meta: { preferredVisualisationType: 'trace' },
      fields: [{ name: 'traceID', type: FieldType.string, values: ['x'] }],
    });
    const out = decodeTraceFrames([f]);
    expect(out[0]).toBe(f);
  });
});
