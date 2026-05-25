import { DataSourceInstanceSettings, MetricFindValue, ScopedVars, TimeRange } from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';
import { firstValueFrom } from 'rxjs';

import { DqlQuery, DqlDataSourceOptions, DEFAULT_QUERY } from './types';

export class DataSource extends DataSourceWithBackend<DqlQuery, DqlDataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<DqlDataSourceOptions>) {
    super(instanceSettings);
  }

  getDefaultQuery() {
    return DEFAULT_QUERY;
  }

  // Run Grafana variable interpolation on the DQL before sending it to the
  // backend. The backend handles $__macros itself (so alerting works without
  // a templateSrv), but $var / ${var:csv} substitution must happen here.
  applyTemplateVariables(query: DqlQuery, scopedVars: ScopedVars): DqlQuery {
    if (!query.dqlQuery) {
      return query;
    }
    const interpolated = getTemplateSrv().replace(query.dqlQuery, scopedVars, 'csv');
    return { ...query, dqlQuery: interpolated };
  }

  filterQuery(query: DqlQuery): boolean {
    return !!query.dqlQuery && query.dqlQuery.trim().length > 0;
  }

  // metricFindQuery powers dashboard variable queries. Frame reduction rules:
  //   - field named `text` + field named `value` (case-insensitive) → pair
  //     them.
  //   - exactly one non-time field → each row becomes { text, value: text }.
  //   - several fields → first non-time field used as both text and value.
  // The reserved `time` field is always skipped so a timeseries result also
  // works as a variable source.
  async metricFindQuery(
    dql: string,
    options?: { variable?: { name: string }; range?: TimeRange }
  ): Promise<MetricFindValue[]> {
    if (!dql || !dql.trim()) {
      return [];
    }
    const refId = `metric-find-${options?.variable?.name ?? 'q'}`;
    const interpolated = getTemplateSrv().replace(dql, undefined, 'csv');

    const response = await firstValueFrom(
      this.query({
        targets: [{ refId, dqlQuery: interpolated } as DqlQuery],
        range: options?.range,
        requestId: refId,
        timezone: 'utc',
        interval: '1m',
        intervalMs: 60_000,
        startTime: Date.now(),
        scopedVars: {},
      } as any)
    );

    const frames = (response as any)?.data ?? [];
    if (!frames.length) {
      return [];
    }
    const frame = frames[0];
    const allFields = frame.fields ?? [];
    if (!allFields.length) {
      return [];
    }

    // Drop the time column — variable queries are scalar, time isn't useful.
    const nonTime = allFields.filter((f: any) => (f.name ?? '').toLowerCase() !== 'time');
    if (!nonTime.length) {
      return [];
    }

    const fieldByName = (name: string) =>
      nonTime.find((f: any) => (f.name ?? '').toLowerCase() === name.toLowerCase());

    const textField = fieldByName('text') ?? nonTime[0];
    const valueField = fieldByName('value') ?? textField;
    const len = textField.values?.length ?? 0;

    const cellAt = (field: any, i: number) =>
      field.values?.get ? field.values.get(i) : field.values?.[i];

    const seen = new Set<string>();
    const out: MetricFindValue[] = [];
    for (let i = 0; i < len; i++) {
      const t = cellAt(textField, i);
      if (t == null || t === '') {
        continue;
      }
      const text = String(t);
      const vRaw = cellAt(valueField, i);
      const value = typeof vRaw === 'number' ? vRaw : String(vRaw ?? text);
      const key = `${text}|${value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({ text, value });
    }
    return out;
  }
}
