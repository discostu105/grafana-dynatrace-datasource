import React, { ChangeEvent } from 'react';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import { DqlDataSourceOptions, DqlQuery } from '../types';

type Props = QueryEditorProps<DataSource, DqlQuery, DqlDataSourceOptions>;

export function QueryEditor({ query, onChange, onRunQuery }: Props) {
  const onDqlChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...query, dqlQuery: event.target.value });
  };

  return (
    <textarea
      aria-label="DQL"
      value={query.dqlQuery ?? ''}
      onChange={onDqlChange}
      onBlur={onRunQuery}
      placeholder="timeseries avg(dt.host.cpu.usage), by:{dt.entity.host}"
      rows={8}
      style={{ width: '100%', fontFamily: 'monospace', padding: 8 }}
    />
  );
}
