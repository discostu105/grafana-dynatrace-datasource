import { formatDql } from './language';

describe('formatDql', () => {
  it('puts each top-level pipe command on its own line', () => {
    const input = 'fetch logs | filter status == 500 | sort timestamp desc | limit 10';
    expect(formatDql(input)).toBe(
      ['fetch logs', '| filter status == 500', '| sort timestamp desc', '| limit 10'].join('\n')
    );
  });

  it('is idempotent', () => {
    const once = formatDql('fetch logs | filter a == 1 | limit 5');
    expect(formatDql(once)).toBe(once);
  });

  it('does not split on pipes inside strings', () => {
    const input = 'fetch logs | filter content == "a | b" | limit 1';
    expect(formatDql(input)).toBe(['fetch logs', '| filter content == "a | b"', '| limit 1'].join('\n'));
  });

  it('does not split on pipes inside brackets', () => {
    const input = 'timeseries x = avg(m), by:{dim} | fieldsAdd y = if(a or b, 1, 0)';
    expect(formatDql(input)).toBe(['timeseries x = avg(m), by:{dim}', '| fieldsAdd y = if(a or b, 1, 0)'].join('\n'));
  });

  it('collapses messy internal whitespace and newlines outside strings', () => {
    const input = 'fetch   logs\n|filter   a == 1\n\n|  limit   10';
    expect(formatDql(input)).toBe(['fetch logs', '| filter a == 1', '| limit 10'].join('\n'));
  });

  it('preserves whitespace inside string literals', () => {
    const input = 'fetch logs | filter content == "two   spaces"';
    expect(formatDql(input)).toBe(['fetch logs', '| filter content == "two   spaces"'].join('\n'));
  });

  it('returns blank/whitespace-only input unchanged', () => {
    expect(formatDql('')).toBe('');
    expect(formatDql('   ')).toBe('   ');
  });

  it('drops trailing empty pipe segments', () => {
    expect(formatDql('fetch logs |')).toBe('fetch logs');
  });
});
