import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export interface DqlQuery extends DataQuery {
  dqlQuery: string;
}

export const DEFAULT_QUERY: Partial<DqlQuery> = {
  dqlQuery: '',
};

// Auth is supplied to the backend via DT_TENANT_URL and DT_TOKEN env vars,
// so there is nothing configurable per-instance from the frontend (yet).
export interface DqlDataSourceOptions extends DataSourceJsonData {}
