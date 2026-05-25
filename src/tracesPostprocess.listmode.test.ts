import { MutableDataFrame, FieldType } from '@grafana/data';
import { enhanceTraceListFrames } from './tracesPostprocess';
import type { DqlQuery } from './types';

function listFrame(traceIDs: string[]) {
  return new MutableDataFrame({
    refId: 'A',
    fields: [
      { name: 'trace.id', type: FieldType.string, values: traceIDs },
      { name: 'span_count', type: FieldType.number, values: traceIDs.map(() => 5) },
    ],
  });
}

function tracesQuery(): DqlQuery {
  return {
    refId: 'A',
    dqlQuery: 'fetch spans | summarize cnt=count(), by:{trace.id}',
    queryType: 'traces',
  };
}

describe('enhanceTraceListFrames', () => {
  const dsUid = 'P6C323D126547F71F';

  it('renames trace.id to traceID and attaches an internal link', () => {
    const f = listFrame(['abc123', 'def456']);
    const byRef = new Map([['A', tracesQuery()]]);
    const out = enhanceTraceListFrames([f], dsUid, byRef);
    const traceField = out[0].fields.find((x) => x.name === 'traceID');
    expect(traceField).toBeDefined();
    const link = traceField!.config?.links?.[0];
    expect(link?.title).toBe('View trace');
    const internal = (link as any)?.internal;
    expect(internal?.datasourceUid).toBe(dsUid);
    expect(internal?.query?.dqlQuery).toContain('trace.id ==');
    expect(internal?.query?.queryType).toBe('traces');
  });

  it('skips frames whose query was not type=traces', () => {
    const f = listFrame(['abc']);
    const byRef = new Map([['A', { ...tracesQuery(), queryType: 'timeseries' } as DqlQuery]]);
    const out = enhanceTraceListFrames([f], dsUid, byRef);
    const before = f.fields.map((x) => x.name).join(',');
    const after = out[0].fields.map((x) => x.name).join(',');
    expect(after).toBe(before); // no rename, no link
  });

  it('skips trace-detail frames (already have the trace vis hint)', () => {
    const f = new MutableDataFrame({
      refId: 'A',
      meta: { preferredVisualisationType: 'trace' },
      fields: [
        { name: 'traceID', type: FieldType.string, values: ['x'] },
        { name: 'spanID', type: FieldType.string, values: ['y'] },
      ],
    });
    const byRef = new Map([['A', tracesQuery()]]);
    const out = enhanceTraceListFrames([f], dsUid, byRef);
    expect(out[0].fields.find((x) => x.name === 'traceID')?.config?.links).toBeUndefined();
  });

  it('handles a frame that already has a traceID column (no trace.id)', () => {
    const f = new MutableDataFrame({
      refId: 'A',
      fields: [{ name: 'traceID', type: FieldType.string, values: ['abc'] }],
    });
    const byRef = new Map([['A', tracesQuery()]]);
    const out = enhanceTraceListFrames([f], dsUid, byRef);
    const link = out[0].fields[0].config?.links?.[0];
    expect(link?.title).toBe('View trace');
  });

  it('no-op when no matching frame exists', () => {
    const byRef = new Map([['A', tracesQuery()]]);
    expect(enhanceTraceListFrames([], dsUid, byRef)).toEqual([]);
  });
});
