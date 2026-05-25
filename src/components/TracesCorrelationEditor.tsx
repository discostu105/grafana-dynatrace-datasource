import React, { ChangeEvent } from 'react';
import { Button, Field as UiField, Input, Stack, TextArea } from '@grafana/ui';
import type { DqlDataSourceOptions, TracesToLogsConfig, TracesToMetricsConfig } from '../types';

interface Props {
  jsonData: DqlDataSourceOptions;
  onChange: (patch: Partial<DqlDataSourceOptions>) => void;
}

const PLACEHOLDER_LOGS = `fetch logs | filter trace_id == "\${__span.traceId}" | sort timestamp asc | limit 200`;

export function TracesCorrelationEditor({ jsonData, onChange }: Props) {
  return (
    <div style={{ marginTop: 24, maxWidth: 720 }}>
      <h4 style={{ marginBottom: 4 }}>Trace ↔ logs</h4>
      <p style={{ marginTop: 0, color: 'var(--theme-colors-text-secondary, #888)', fontSize: 12 }}>
        Renders a &ldquo;Logs for this span&rdquo; button in the trace view. <code>{'${__span.traceId}'}</code> and{' '}
        <code>{'${__span.spanId}'}</code> are substituted at click time.
      </p>
      <TracesToLogsBlock value={jsonData.tracesToLogs} onChange={(v) => onChange({ tracesToLogs: dropIfEmpty(v) })} />

      <h4 style={{ marginTop: 24, marginBottom: 4 }}>Trace ↔ metrics</h4>
      <p style={{ marginTop: 0, color: 'var(--theme-colors-text-secondary, #888)', fontSize: 12 }}>
        Each named query becomes a &ldquo;Metrics for this span&rdquo; button.
      </p>
      <TracesToMetricsBlock
        value={jsonData.tracesToMetrics}
        onChange={(v) => onChange({ tracesToMetrics: dropIfEmpty(v) })}
      />
    </div>
  );
}

function TracesToLogsBlock({
  value,
  onChange,
}: {
  value: TracesToLogsConfig | undefined;
  onChange: (next: TracesToLogsConfig) => void;
}) {
  const v = value ?? {};
  const update = (patch: Partial<TracesToLogsConfig>) => onChange({ ...v, ...patch });
  return (
    <Stack direction="column" gap={1}>
      <UiField label="Target datasource UID" description="Often this plugin's own UID for trace→DQL log correlation.">
        <Input
          width={50}
          placeholder="P6C323D126547F71F"
          value={v.datasourceUid ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update({ datasourceUid: e.target.value || undefined })}
        />
      </UiField>
      <UiField label="DQL template" description="Uses ${__span.traceId} / ${__span.spanId} placeholders.">
        <TextArea
          rows={3}
          placeholder={PLACEHOLDER_LOGS}
          value={v.query ?? ''}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => update({ query: e.target.value || undefined })}
        />
      </UiField>
    </Stack>
  );
}

function TracesToMetricsBlock({
  value,
  onChange,
}: {
  value: TracesToMetricsConfig | undefined;
  onChange: (next: TracesToMetricsConfig) => void;
}) {
  const v = value ?? {};
  const queries = v.queries ?? [];
  const updateUid = (s: string) => onChange({ ...v, datasourceUid: s || undefined });
  const updateQuery = (idx: number, patch: Partial<{ name: string; query: string }>) => {
    const next = queries.map((q, i) => (i === idx ? { ...q, ...patch } : q));
    onChange({ ...v, queries: next });
  };
  const removeQuery = (idx: number) => onChange({ ...v, queries: queries.filter((_, i) => i !== idx) });
  const addQuery = () => onChange({ ...v, queries: [...queries, { name: '', query: '' }] });

  return (
    <Stack direction="column" gap={1}>
      <UiField label="Target datasource UID">
        <Input
          width={50}
          placeholder="P6C323D126547F71F"
          value={v.datasourceUid ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => updateUid(e.target.value)}
        />
      </UiField>
      {queries.map((q, i) => (
        <Stack key={i} direction="row" gap={1} alignItems="flex-end">
          <UiField label="Name">
            <Input
              width={18}
              placeholder="Error rate"
              value={q.name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => updateQuery(i, { name: e.target.value })}
            />
          </UiField>
          <UiField label="DQL query">
            <TextArea
              cols={50}
              rows={2}
              placeholder='timeseries err = countIf(request.is_failed), filter:{service.name == "${__span.tags["service.name"]}"}'
              value={q.query}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateQuery(i, { query: e.target.value })}
            />
          </UiField>
          <Button variant="destructive" size="sm" onClick={() => removeQuery(i)} icon="trash-alt">
            Remove
          </Button>
        </Stack>
      ))}
      <Button variant="secondary" size="sm" icon="plus" onClick={addQuery} style={{ alignSelf: 'flex-start' }}>
        Add metric query
      </Button>
    </Stack>
  );
}

// Drop the config entirely if the user has cleared everything; saves
// the round trip back to a no-op default object.
function dropIfEmpty<T extends object>(v: T): T | undefined {
  const keys = Object.keys(v).filter((k) => {
    const x = (v as Record<string, unknown>)[k];
    return x != null && x !== '' && !(Array.isArray(x) && x.length === 0);
  });
  return keys.length ? v : undefined;
}
