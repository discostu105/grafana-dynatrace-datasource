import { DEFAULT_BUILDER, dqlFromBuilder } from './builder';
import type { BuilderState } from './types';

function s(overrides: Partial<BuilderState> = {}): BuilderState {
  return { ...DEFAULT_BUILDER, ...overrides };
}

describe('dqlFromBuilder', () => {
  it('default state → bare count over logs', () => {
    expect(dqlFromBuilder(DEFAULT_BUILDER)).toBe('fetch logs\n| summarize cnt = count()');
  });

  it('emits filter rows joined with AND', () => {
    const dql = dqlFromBuilder(
      s({
        filters: [
          { field: 'host.name', operator: '==', value: 'h1' },
          { field: 'service.name', operator: '!=', value: 'noisy' },
        ],
      })
    );
    expect(dql).toContain('host.name == "h1"');
    expect(dql).toContain('service.name != "noisy"');
    expect(dql.split('| filter ')[1]).toContain(' AND ');
  });

  it('contains and matches operators use the right DQL functions', () => {
    const dql = dqlFromBuilder(
      s({
        filters: [
          { field: 'body', operator: 'contains', value: 'oops' },
          { field: 'name', operator: 'matches', value: 'prod-*' },
        ],
      })
    );
    expect(dql).toContain('contains(body, "oops")');
    expect(dql).toContain('matchesValue(name, "prod-*")');
  });

  it('drops incomplete filter rows', () => {
    const dql = dqlFromBuilder(
      s({
        filters: [
          { field: '', operator: '==', value: 'x' },
          { field: 'k', operator: '==', value: '' },
          { field: 'k', operator: '==', value: 'v' },
        ],
      })
    );
    expect(dql).toContain('| filter k == "v"');
    expect(dql).not.toMatch(/\| filter[^|]*AND/);
  });

  it('group-by adds bucket and dimensions in summarize', () => {
    const dql = dqlFromBuilder(
      s({
        source: 'spans',
        aggregation: { fn: 'avg', field: 'duration' },
        groupBy: ['service.name'],
        bucket: '5m',
      })
    );
    expect(dql).toContain('fetch spans');
    expect(dql).toContain('summarize cnt = avg(duration)');
    expect(dql).toContain('by:{bin(timestamp, 5m), service.name}');
  });

  it('auto bucket maps to $__interval', () => {
    const dql = dqlFromBuilder(s({ groupBy: ['k'], bucket: 'auto', aggregation: { fn: 'count' } }));
    expect(dql).toContain('bin(timestamp, $__interval)');
  });

  it('escapes embedded quotes in values', () => {
    const dql = dqlFromBuilder(s({ filters: [{ field: 'msg', operator: '==', value: 'has "quote"' }] }));
    expect(dql).toContain('msg == "has \\"quote\\""');
  });

  it('non-count aggregation defaults the field to value', () => {
    const dql = dqlFromBuilder(s({ aggregation: { fn: 'avg' }, source: 'metric.series', groupBy: ['k'] }));
    expect(dql).toContain('avg(value)');
  });
});
