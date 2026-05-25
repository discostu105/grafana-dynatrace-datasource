import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  DataSourceWithLogsContextSupport,
  DataSourceWithSupplementaryQueriesSupport,
  LogRowContextOptions,
  LogRowContextQueryDirection,
  LogRowModel,
  MetricFindValue,
  ScopedVars,
  SupplementaryQueryOptions,
  SupplementaryQueryType,
  TimeRange,
} from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv, getTemplateSrv } from '@grafana/runtime';
import { Observable, firstValueFrom } from 'rxjs';

import { AdhocFilter, DqlQuery, DqlDataSourceOptions, DEFAULT_QUERY } from './types';

// Curated tag keys we always expose for the ad-hoc filter UI. The Loxone
// tenant we've seen in practice carries control.name / control.category /
// control.room / state.name / unit on every metric series; entity-typed
// data uses dt.entity.host / host.name / service.name / k8s.namespace.name.
// These are merged with whatever Grail's autocomplete reports.
const CURATED_TAG_KEYS = [
  'control.name',
  'control.category',
  'control.room',
  'control.type',
  'state.name',
  'unit',
  'dt.entity.host.name',
  'dt.entity.host',
  'host.name',
  'service.name',
  'k8s.namespace.name',
];

export class DataSource
  extends DataSourceWithBackend<DqlQuery, DqlDataSourceOptions>
  implements
    DataSourceWithSupplementaryQueriesSupport<DqlQuery>,
    DataSourceWithLogsContextSupport<DqlQuery>
{
  constructor(instanceSettings: DataSourceInstanceSettings<DqlDataSourceOptions>) {
    super(instanceSettings);
  }

  getDefaultQuery() {
    return DEFAULT_QUERY;
  }

  // applyTemplateVariables runs once per query on the way to the backend:
  //  - $var / ${var:csv} interpolation (the backend does $__macros itself
  //    so alerting works without a templateSrv)
  //  - stamps the dashboard's ad-hoc filters onto the query so the backend
  //    can substitute $__adhocFilters / auto-append `| filter ...`
  applyTemplateVariables(query: DqlQuery, scopedVars: ScopedVars): DqlQuery {
    const dql = query.dqlQuery
      ? getTemplateSrv().replace(query.dqlQuery, scopedVars, 'csv')
      : query.dqlQuery;
    const adhocFilters = this.collectAdhocFilters();
    return { ...query, dqlQuery: dql, adhocFilters };
  }

  filterQuery(query: DqlQuery): boolean {
    return !!query.dqlQuery && query.dqlQuery.trim().length > 0;
  }

  // collectAdhocFilters pulls the dashboard's ad-hoc filter variables that
  // target this datasource. Grafana stores them as variables of type 'adhoc'
  // with a `filters: Array<{key, operator, value}>` payload.
  private collectAdhocFilters(): AdhocFilter[] {
    const vars = getTemplateSrv().getVariables();
    const out: AdhocFilter[] = [];
    for (const v of vars) {
      // Older Grafana versions: variable.type === 'adhoc' && variable.datasource matches
      if ((v as any).type !== 'adhoc') {
        continue;
      }
      const ds = (v as any).datasource;
      // datasource can be a string (name/uid), {uid}, or null; match by uid first
      const matches =
        !ds ||
        ds === this.name ||
        ds === this.uid ||
        (ds?.uid && (ds.uid === this.uid || ds.uid === '$datasource'));
      if (!matches) {
        continue;
      }
      for (const f of (v as any).filters ?? []) {
        if (!f?.key || f?.value == null) {
          continue;
        }
        out.push({ key: String(f.key), operator: String(f.operator ?? '='), value: String(f.value) });
      }
    }
    return out;
  }

  // ---- Ad-hoc filter discovery -------------------------------------------

  // getTagKeys is called by Grafana when the user opens the ad-hoc filter
  // dropdown for the first time. We return the curated list above merged
  // with anything Grail's autocomplete suggests for a `filter <cursor>`
  // position. Cheap: one autocomplete call, results are cached client-side
  // by Grafana.
  async getTagKeys(): Promise<MetricFindValue[]> {
    const keys = new Set<string>(CURATED_TAG_KEYS);
    try {
      const r = await this.callAutocomplete('fetch metric.series | filter ', 'fetch metric.series | filter '.length);
      for (const s of r.suggestions ?? []) {
        if (s.suggestion && (s.parts?.[0]?.type === 'FIELD' || s.parts?.[0]?.type === 'PARAMETER_KEY')) {
          keys.add(s.suggestion);
        }
      }
    } catch {
      // ignore — curated list is still useful
    }
    return [...keys].sort().map((text) => ({ text }));
  }

  // getTagValues is called when the user picks a key and is choosing a
  // value. Run `summarize by:{<key>}` against the metric.series catalogue
  // (cheap — metric.series is a metadata view, no data points scanned).
  async getTagValues(options: { key: string }): Promise<MetricFindValue[]> {
    if (!options?.key) {
      return [];
    }
    // The key may contain dots; DQL accepts them bare in `by:{}` clauses.
    const dql = `fetch metric.series | summarize count(), by:{${options.key}} | fields ${options.key} | sort ${options.key} asc | limit 1000`;
    const values = await this.metricFindQuery(dql);
    return values.map((v) => ({ text: String(v.text) }));
  }

  // ---- metricFindQuery (variable queries) --------------------------------

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

  // callAutocomplete hits the plugin's resource handler, which proxies
  // Grail's /platform/storage/query/v1/query:autocomplete.
  private callAutocomplete(query: string, position: number) {
    return getBackendSrv().post(
      `/api/datasources/uid/${this.uid}/resources/autocomplete`,
      { query, position }
    );
  }

  // ---- Log volume histogram (DataSourceWithSupplementaryQueriesSupport) ---
  //
  // Grafana asks the data source for a "supplementary" query alongside the
  // main one when rendering the logs panel. Returning a LogsVolume query
  // here drives the bar chart Grafana displays above the log lines, broken
  // down by severity. Pattern matches grafana-clickhouse-datasource.

  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume];
  }

  getSupplementaryQuery(
    options: SupplementaryQueryOptions,
    query: DqlQuery
  ): DqlQuery | undefined {
    if (options.type !== SupplementaryQueryType.LogsVolume) {
      return undefined;
    }
    if (query.queryType !== 'logs' || !query.dqlQuery) {
      return undefined;
    }
    // Wrap the user's logs query with a `summarize count(), by:{bin(timestamp,
    // $__interval), severity}` so the result is a timeseries grouped by level.
    // Backend's $__interval macro picks a sensible bucket size; we don't
    // touch the original DQL beyond appending.
    const wrapped = `${query.dqlQuery.trim()}
| summarize count = count(), by:{interval = bin(timestamp, $__interval), severity = if(isNotNull(loglevel), loglevel, else: "unknown")}`;
    return {
      ...query,
      refId: `${query.refId}-volume`,
      dqlQuery: wrapped,
      queryType: 'timeseries',
    };
  }

  getDataProvider(
    type: SupplementaryQueryType,
    request: DataQueryRequest<DqlQuery>
  ): Observable<DataQueryResponse> | undefined {
    if (type !== SupplementaryQueryType.LogsVolume) {
      return undefined;
    }
    const targets = request.targets
      .map((t) => this.getSupplementaryQuery({ type }, t))
      .filter((t): t is DqlQuery => !!t);
    if (!targets.length) {
      return undefined;
    }
    return this.query({ ...request, targets });
  }

  // ---- Log row context (DataSourceWithLogsContextSupport) ----------------

  // showContextToggle hides the "show context" button when there's nothing
  // to anchor against. We require at least one label on the row (otherwise
  // the surrounding-lines query would be unfiltered and useless).
  showContextToggle(row?: LogRowModel): boolean {
    return !!row?.labels && Object.keys(row.labels).length > 0;
  }

  async getLogRowContext(
    row: LogRowModel,
    options?: LogRowContextOptions,
    origQuery?: DqlQuery
  ): Promise<DataQueryResponse> {
    const limit = options?.limit ?? 50;
    const direction =
      options?.direction === LogRowContextQueryDirection.Forward ? 'asc' : 'desc';
    const cmp = direction === 'asc' ? '>=' : '<=';
    const labels = row.labels ?? {};
    const selectorParts = Object.entries(labels)
      .filter(([k]) => k && !['level', 'loglevel', 'severity'].includes(k))
      .map(([k, v]) => `${k} == "${String(v).replace(/"/g, '\\"')}"`);
    const labelFilter = selectorParts.length ? selectorParts.join(' AND ') : 'true';
    const ts = row.timeEpochMs;
    const dql =
      `fetch logs | filter ${labelFilter} ` +
      `| filter timestamp ${cmp} fromUnixMillis(${ts}) ` +
      `| sort timestamp ${direction} | limit ${limit}`;

    const refId = `${origQuery?.refId ?? 'A'}-ctx-${direction}`;
    return firstValueFrom(
      this.query({
        targets: [{ refId, dqlQuery: dql, queryType: 'logs' } as DqlQuery],
        requestId: refId,
        timezone: 'utc',
        interval: '1m',
        intervalMs: 60_000,
        startTime: Date.now(),
        scopedVars: {},
        range: {
          from: { valueOf: () => ts - 60 * 60 * 1000 } as any,
          to: { valueOf: () => ts + 60 * 60 * 1000 } as any,
          raw: { from: '', to: '' } as any,
        },
      } as any)
    );
  }
}
