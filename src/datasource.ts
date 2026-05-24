import { DataSourceInstanceSettings } from '@grafana/data';
import { DataSourceWithBackend } from '@grafana/runtime';

import { DqlQuery, DqlDataSourceOptions, DEFAULT_QUERY } from './types';

export class DataSource extends DataSourceWithBackend<DqlQuery, DqlDataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<DqlDataSourceOptions>) {
    super(instanceSettings);
  }

  getDefaultQuery() {
    return DEFAULT_QUERY;
  }

  filterQuery(query: DqlQuery): boolean {
    return !!query.dqlQuery && query.dqlQuery.trim().length > 0;
  }
}
