import { MutableDataFrame, FieldType } from '@grafana/data';
import { stampTraceCorrelations } from './tracesPostprocess';

function traceFrame() {
  return new MutableDataFrame({
    refId: 'A',
    meta: { preferredVisualisationType: 'trace' },
    fields: [{ name: 'traceID', type: FieldType.string, values: ['t1'] }],
  });
}

describe('stampTraceCorrelations', () => {
  it('stamps logs config onto trace frames Meta.Custom', () => {
    const cfg = { datasourceUid: 'ds1', query: 'fetch logs | filter trace_id == "${__span.traceId}"' };
    const out = stampTraceCorrelations([traceFrame()], cfg);
    const custom = (out[0].meta?.custom ?? {}) as Record<string, unknown>;
    expect(custom.tracesToLogs).toBe(cfg);
    // Also stamps tracesToLogsV2 for newer Grafana — both names point at the same config.
    expect(custom.tracesToLogsV2).toBe(cfg);
  });

  it('stamps metrics config when at least one query is set', () => {
    const cfg = { datasourceUid: 'ds1', queries: [{ name: 'Errors', query: 'timeseries x = count()' }] };
    const out = stampTraceCorrelations([traceFrame()], undefined, cfg);
    const custom = (out[0].meta?.custom ?? {}) as Record<string, unknown>;
    expect(custom.tracesToMetrics).toBe(cfg);
  });

  it('is a no-op when both configs are empty / incomplete', () => {
    const original = traceFrame();
    const out = stampTraceCorrelations([original]);
    expect(out[0].meta?.custom).toBeUndefined();

    const out2 = stampTraceCorrelations([original], { datasourceUid: 'ds1' }); // no query → drop
    expect(out2[0].meta?.custom).toBeUndefined();
  });

  it('does not stamp non-trace frames', () => {
    const f = new MutableDataFrame({
      refId: 'A',
      meta: { preferredVisualisationType: 'graph' as any },
      fields: [{ name: 'x', type: FieldType.string, values: ['y'] }],
    });
    const out = stampTraceCorrelations([f], { datasourceUid: 'ds1', query: 'q' });
    expect(out[0].meta?.custom).toBeUndefined();
  });
});
