import React from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { DqlDataSourceOptions } from '../types';

type Props = DataSourcePluginOptionsEditorProps<DqlDataSourceOptions>;

export function ConfigEditor(_props: Props) {
  return (
    <div style={{ padding: 8, maxWidth: 720 }}>
      <p>
        This data source authenticates against Dynatrace via two environment variables read by the
        backend plugin process at startup:
      </p>
      <ul>
        <li>
          <code>DT_TENANT_URL</code> — e.g. <code>https://abc.apps.dynatrace.com</code>
        </li>
        <li>
          <code>DT_TOKEN</code> — a platform token (<code>dt0s16.…</code>)
        </li>
      </ul>
      <p>
        There is nothing to configure here. Click <strong>Save &amp; test</strong> to verify the
        backend can reach the tenant.
      </p>
    </div>
  );
}
