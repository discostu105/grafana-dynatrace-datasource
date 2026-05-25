import React, { ChangeEvent } from 'react';
import { QueryEditorProps } from '@grafana/data';
import { CodeEditor, InlineField, RadioButtonGroup, Input, Button, Stack } from '@grafana/ui';
import { DataSource } from '../datasource';
import { DqlDataSourceOptions, DqlQuery, DqlQueryType } from '../types';
import { DQL_LANGUAGE_ID, registerDqlLanguage } from '../dql/language';
import { SELECTORS } from '../selectors';

type Props = QueryEditorProps<DataSource, DqlQuery, DqlDataSourceOptions>;

const QUERY_TYPES: Array<{ label: string; value: DqlQueryType }> = [
  { label: SELECTORS.queryEditor.queryTypeRadios.timeseries, value: 'timeseries' },
  { label: SELECTORS.queryEditor.queryTypeRadios.logs, value: 'logs' },
  { label: SELECTORS.queryEditor.queryTypeRadios.traces, value: 'traces' },
];

export function QueryEditor({ query, onChange, onRunQuery, datasource }: Props) {
  const queryType: DqlQueryType = query.queryType ?? 'timeseries';

  const onDqlChange = (value: string) => {
    onChange({ ...query, dqlQuery: value });
  };

  const onTypeChange = (value: DqlQueryType) => {
    onChange({ ...query, queryType: value });
    onRunQuery();
  };

  const onBodyFieldChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...query, logBodyField: event.target.value || undefined });
  };

  return (
    <div>
      <Stack direction="row" gap={1} alignItems="center">
        <InlineField label={SELECTORS.queryEditor.queryTypeLabel} labelWidth={18}>
          <RadioButtonGroup options={QUERY_TYPES} value={queryType} onChange={onTypeChange} />
        </InlineField>
        <Button size="sm" variant="secondary" onClick={onRunQuery} icon="play">
          {SELECTORS.queryEditor.runButtonLabel}
        </Button>
      </Stack>
      {queryType === 'logs' && (
        <InlineField
          label={SELECTORS.queryEditor.bodyFieldLabel}
          labelWidth={18}
          tooltip="Column carrying the log message. Defaults to `content` (DQL `fetch logs` default)."
        >
          <Input width={30} placeholder="content" value={query.logBodyField ?? ''} onChange={onBodyFieldChange} />
        </InlineField>
      )}
      {queryType === 'timeseries' && (
        <InlineField
          label={SELECTORS.queryEditor.legendLabel}
          labelWidth={18}
          tooltip="Optional series name template. Use {{ control.name }} or ${__field.labels.control.name}. Leave blank for the default (the most relevant label, e.g. control.name)."
        >
          <Input
            width={40}
            placeholder="{{ control.name }}"
            value={query.legendFormat ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onChange({ ...query, legendFormat: e.target.value || undefined })
            }
          />
        </InlineField>
      )}
      <div style={{ marginTop: 8 }}>
        <CodeEditor
          value={query.dqlQuery ?? ''}
          language={DQL_LANGUAGE_ID}
          height={180}
          showLineNumbers
          showMiniMap={false}
          onBlur={onDqlChange}
          onSave={(v) => {
            onDqlChange(v);
            onRunQuery();
          }}
          onBeforeEditorMount={(monaco) => {
            registerDqlLanguage(monaco, (dql, position) => datasource.autocomplete(dql, position));
          }}
          onEditorDidMount={(editor, monaco) => {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
              onDqlChange(editor.getValue());
              onRunQuery();
            });
          }}
          monacoOptions={{
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontFamily: 'monospace',
          }}
        />
      </div>
    </div>
  );
}
