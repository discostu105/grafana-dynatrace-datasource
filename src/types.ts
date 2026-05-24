import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export interface DqlQuery extends DataQuery {
  dqlQuery: string;
}

export const DEFAULT_QUERY: Partial<DqlQuery> = {
  dqlQuery: '',
};

export interface DqlDataSourceOptions extends DataSourceJsonData {
  tenantUrl?: string;
  queryTimeoutSeconds?: number;
  // Go duration string used when the panel has no time range (variable
  // queries, alerting probes). Defaults to "1h" on the backend.
  defaultTimeframe?: string;
}

export interface DqlSecureJsonData {
  apiToken?: string;
}
