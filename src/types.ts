import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export type DqlQueryType = 'timeseries' | 'logs' | 'traces';

export interface DqlQuery extends DataQuery {
  dqlQuery: string;
  // Default 'timeseries'. When 'logs', the backend maps records to a logs
  // frame (Meta.PreferredVisualisation=logs, time/body/level/labels).
  queryType?: DqlQueryType;
  // Override the column that carries the log body when queryType=logs.
  // Defaults to 'content' (DQL `fetch logs` default).
  logBodyField?: string;
  // Optional Grafana legend template for the value series, e.g.
  // "{{ control.name }} (avg)". Mapped to Field.Config.DisplayName on the
  // backend; Grafana then resolves ${__field.labels.X} expressions itself.
  legendFormat?: string;
  // Ad-hoc filters from the dashboard's top bar, stamped onto the query
  // by applyTemplateVariables() on the way to the backend. The backend
  // substitutes $__adhocFilters or auto-appends `| filter ...`.
  adhocFilters?: AdhocFilter[];
}

export interface AdhocFilter {
  key: string;
  operator: string; // "=", "!=", "=~", "!~"
  value: string;
}

export const DEFAULT_QUERY: Partial<DqlQuery> = {
  dqlQuery: '',
  queryType: 'timeseries',
};

export interface DqlDataSourceOptions extends DataSourceJsonData {
  tenantUrl?: string;
  queryTimeoutSeconds?: number;
  // Go duration string used when the panel has no time range (variable
  // queries, alerting probes). Defaults to "1h" on the backend.
  defaultTimeframe?: string;
  // Derived field rules — regex over log body → clickable URL link.
  // Each rule produces a new field on the logs frame whose values are
  // the first regex capture group; Grafana's logs panel renders them as
  // buttons that open the URL with ${__value.raw} substituted.
  derivedFields?: DerivedField[];
}

export interface DerivedField {
  // Name of the new field added to the logs frame. Shown as the button
  // label in the logs detail view (overridden by `urlDisplayLabel` if set).
  name: string;
  // Regex applied against each row's body. The first capture group is
  // the extracted value. Patterns without a capture group fall back to
  // the whole match.
  matcherRegex: string;
  // URL template. ${__value.raw} is replaced with the captured value;
  // standard Grafana template vars also work.
  url: string;
  // Optional button label override. Defaults to `name`.
  urlDisplayLabel?: string;
  // Optional Grafana datasource UID — when set, the link becomes an
  // "internal" link that opens Explore against that datasource.
  datasourceUid?: string;
}

export interface DqlSecureJsonData {
  apiToken?: string;
}
