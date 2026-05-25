import { MutableDataFrame } from '@grafana/data';
import { applyDerivedFields } from './derivedFields';
import type { DerivedField } from './types';

function logFrame(bodies: Array<string | null>) {
  const f = new MutableDataFrame({
    refId: 'A',
    meta: { preferredVisualisationType: 'logs' },
    fields: [
      { name: 'time', type: 'time' as any, values: bodies.map((_, i) => i * 1000) },
      { name: 'body', type: 'string' as any, values: bodies },
    ],
  });
  return f;
}

const TRACE_RULE: DerivedField = {
  name: 'TraceID',
  matcherRegex: 'trace[_-]?id=([a-f0-9]+)',
  url: '/explore?orgId=1&trace=${__value.raw}',
};

describe('applyDerivedFields', () => {
  it('passes through when there are no rules', () => {
    const frames = [logFrame(['hello'])];
    const out = applyDerivedFields(frames, []);
    expect(out[0].fields.length).toBe(2);
  });

  it('extracts capture group and attaches a DataLink', () => {
    const frames = [logFrame(['no trace here', 'request done trace_id=abc123 ok', 'another trace-id=def456'])];
    const out = applyDerivedFields(frames, [TRACE_RULE]);
    const enriched = out[0];
    expect(enriched.fields.map((f) => f.name)).toEqual(['time', 'body', 'TraceID']);
    const traceField = enriched.fields.find((f) => f.name === 'TraceID')!;
    expect(traceField.values.get(0)).toBeNull();
    expect(traceField.values.get(1)).toBe('abc123');
    expect(traceField.values.get(2)).toBe('def456');
    const link = traceField.config!.links![0];
    expect(link.url).toContain('${__value.raw}');
    expect(link.title).toBe('TraceID');
  });

  it('skips frames that are not logs-typed', () => {
    const f = new MutableDataFrame({
      refId: 'A',
      meta: { preferredVisualisationType: 'graph' as any },
      fields: [{ name: 'body', type: 'string' as any, values: ['trace_id=abc'] }],
    });
    const out = applyDerivedFields([f], [TRACE_RULE]);
    expect(out[0].fields.length).toBe(1);
  });

  it('drops invalid regex rules without crashing', () => {
    const frames = [logFrame(['trace_id=abc'])];
    const out = applyDerivedFields(frames, [{ ...TRACE_RULE, matcherRegex: '[invalid(' }]);
    expect(out[0].fields.length).toBe(2);
  });

  it('omits the derived column when no row matches', () => {
    const frames = [logFrame(['nothing', 'still nothing'])];
    const out = applyDerivedFields(frames, [TRACE_RULE]);
    expect(out[0].fields.map((f) => f.name)).toEqual(['time', 'body']);
  });

  it('marks internal-DS links so Grafana opens Explore', () => {
    const frames = [logFrame(['trace_id=abc'])];
    const out = applyDerivedFields(frames, [{ ...TRACE_RULE, datasourceUid: 'tempo-uid' }]);
    const traceField = out[0].fields.find((f) => f.name === 'TraceID')!;
    const link = traceField.config!.links![0] as any;
    expect(link.internal?.datasourceUid).toBe('tempo-uid');
    expect(link.targetBlank).toBe(false);
  });
});
