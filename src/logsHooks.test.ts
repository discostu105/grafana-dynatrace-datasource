import { LogRowContextQueryDirection, SupplementaryQueryType } from '@grafana/data';
import { buildLogContextDQL, buildLogsVolumeQuery } from './logsHooks';
import type { DqlQuery } from './types';

describe('buildLogsVolumeQuery', () => {
  const base: DqlQuery = {
    refId: 'A',
    dqlQuery: 'fetch logs | filter host.name == "h1"',
    queryType: 'logs',
  };

  it('wraps the base query with a severity-grouped summarize', () => {
    const out = buildLogsVolumeQuery(SupplementaryQueryType.LogsVolume, base);
    expect(out).toBeDefined();
    expect(out!.queryType).toBe('timeseries');
    expect(out!.refId).toBe('A-volume');
    expect(out!.dqlQuery).toContain('fetch logs');
    expect(out!.dqlQuery).toContain('bin(timestamp, $__interval)');
    expect(out!.dqlQuery).toContain('severity =');
  });

  it('returns undefined for non-logs queries', () => {
    expect(
      buildLogsVolumeQuery(SupplementaryQueryType.LogsVolume, { ...base, queryType: 'timeseries' })
    ).toBeUndefined();
  });

  it('returns undefined when DQL is empty', () => {
    expect(buildLogsVolumeQuery(SupplementaryQueryType.LogsVolume, { ...base, dqlQuery: '' })).toBeUndefined();
  });

  it('returns undefined for unsupported supplementary types', () => {
    expect(buildLogsVolumeQuery('whatever' as SupplementaryQueryType, base)).toBeUndefined();
  });
});

describe('buildLogContextDQL', () => {
  const row = {
    labels: { 'host.name': 'h1', 'service.name': 'svc', level: 'info', loglevel: 'INFO' },
    timeEpochMs: 1_700_000_000_000,
  } as any;

  it('strips severity-flavoured labels from the selector', () => {
    const { dql } = buildLogContextDQL(row);
    expect(dql).toContain('host.name == "h1"');
    expect(dql).toContain('service.name == "svc"');
    expect(dql).not.toContain('level ==');
    expect(dql).not.toContain('loglevel ==');
  });

  it('orders backward by default and forward when requested', () => {
    const back = buildLogContextDQL(row).dql;
    expect(back).toContain('timestamp <= fromUnixMillis(1700000000000)');
    expect(back).toMatch(/sort timestamp desc/);

    const fwd = buildLogContextDQL(row, { direction: LogRowContextQueryDirection.Forward, limit: 25 }).dql;
    expect(fwd).toContain('timestamp >= fromUnixMillis(1700000000000)');
    expect(fwd).toMatch(/sort timestamp asc/);
    expect(fwd).toMatch(/limit 25/);
  });

  it('escapes quotes in label values', () => {
    const { dql } = buildLogContextDQL({ ...row, labels: { 'service.name': 'has"quote' } } as any);
    expect(dql).toContain('service.name == "has\\"quote"');
  });

  it('falls back to true when no labels survive filtering', () => {
    const { dql } = buildLogContextDQL({ labels: { level: 'info' }, timeEpochMs: 1 } as any);
    expect(dql).toContain('filter true');
  });

  it('returns a +/- 1h window around the row timestamp', () => {
    const { fromMs, toMs } = buildLogContextDQL(row);
    expect(toMs - row.timeEpochMs).toBe(60 * 60 * 1000);
    expect(row.timeEpochMs - fromMs).toBe(60 * 60 * 1000);
  });
});
