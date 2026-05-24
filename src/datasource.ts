import { DataSourceInstanceSettings, ScopedVars } from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';

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

  // metricFindQuery powers dashboard variable queries. The DQL must return
  // either:
  //   - one column → each row becomes { text, value: text }
  //   - two columns named text + value (case-insensitive) → use them
  //   - otherwise → first column used as both text and value
  async metricFindQuery(dql: string, options?: { variable?: { name: string }; range?: any }): Promise<Array<{ text: string; value: string | number }>> {
    if (!dql || !dql.trim()) {
      return [];
    }
    const refId = `metric-find-${options?.variable?.name ?? 'q'}`;
    const interpolated = getTemplateSrv().replace(dql, undefined, 'csv');
    const result = await this.query({
      targets: [{ refId, dqlQuery: interpolated } as DqlQuery],
      range: options?.range,
      requestId: refId,
    } as any).toPromise();

    const frames = (result as any)?.data ?? [];
    if (!frames.length) {
      return [];
    }
    const frame = frames[0];
    const fields = frame.fields ?? [];
    if (!fields.length) {
      return [];
    }

    const fieldByName = (name: string) =>
      fields.find((f: any) => (f.name ?? '').toLowerCase() === name.toLowerCase());
    const textField = fieldByName('text') ?? fields[0];
    const valueField = fieldByName('value') ?? textField;
    const len = textField.values?.length ?? 0;

    const out: Array<{ text: string; value: string | number }> = [];
    for (let i = 0; i < len; i++) {
      const t = String(textField.values.get ? textField.values.get(i) : textField.values[i]);
      const vRaw = valueField.values.get ? valueField.values.get(i) : valueField.values[i];
      const v = typeof vRaw === 'number' ? vRaw : String(vRaw ?? t);
      out.push({ text: t, value: v });
    }
    return out;
  }
}
