import React, { ChangeEvent } from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { InlineField, Input, SecretInput } from '@grafana/ui';
import { DqlDataSourceOptions, DqlSecureJsonData } from '../types';
import { SELECTORS } from '../selectors';

type Props = DataSourcePluginOptionsEditorProps<DqlDataSourceOptions, DqlSecureJsonData>;

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData, secureJsonFields, secureJsonData } = options;

  const updateJson = (patch: Partial<DqlDataSourceOptions>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, ...patch } });
  };

  const onTenantUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
    updateJson({ tenantUrl: e.target.value });
  };

  const onTimeoutChange = (e: ChangeEvent<HTMLInputElement>) => {
    const n = parseInt(e.target.value, 10);
    updateJson({ queryTimeoutSeconds: Number.isFinite(n) && n > 0 ? n : undefined });
  };

  const onDefaultTimeframeChange = (e: ChangeEvent<HTMLInputElement>) => {
    updateJson({ defaultTimeframe: e.target.value || undefined });
  };

  const onApiTokenChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      secureJsonData: { ...(secureJsonData ?? {}), apiToken: e.target.value },
    });
  };

  const onApiTokenReset = () => {
    onOptionsChange({
      ...options,
      secureJsonFields: { ...secureJsonFields, apiToken: false },
      secureJsonData: { ...(secureJsonData ?? {}), apiToken: '' },
    });
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <InlineField
        label={SELECTORS.configEditor.tenantUrlLabel}
        labelWidth={22}
        tooltip="e.g. https://abc.apps.dynatrace.com"
      >
        <Input
          width={50}
          placeholder="https://<env>.apps.dynatrace.com"
          value={jsonData.tenantUrl ?? ''}
          onChange={onTenantUrlChange}
        />
      </InlineField>
      <InlineField label={SELECTORS.configEditor.apiTokenLabel} labelWidth={22} tooltip="Platform token, e.g. dt0s16.…">
        <SecretInput
          width={50}
          placeholder="dt0s16.XXXX..."
          isConfigured={Boolean(secureJsonFields?.apiToken)}
          value={secureJsonData?.apiToken ?? ''}
          onChange={onApiTokenChange}
          onReset={onApiTokenReset}
        />
      </InlineField>
      <InlineField
        label={SELECTORS.configEditor.queryTimeoutLabel}
        labelWidth={22}
        tooltip="Per-query deadline. Default 30s."
      >
        <Input
          type="number"
          width={20}
          min={1}
          max={600}
          placeholder="30"
          value={jsonData.queryTimeoutSeconds ?? ''}
          onChange={onTimeoutChange}
        />
      </InlineField>
      <InlineField
        label={SELECTORS.configEditor.defaultTimeframeLabel}
        labelWidth={22}
        tooltip="Used when the request has no time range (variable queries, alerting probes). Go duration string, e.g. 1h, 24h."
      >
        <Input
          width={20}
          placeholder="1h"
          value={jsonData.defaultTimeframe ?? ''}
          onChange={onDefaultTimeframeChange}
        />
      </InlineField>
    </div>
  );
}
