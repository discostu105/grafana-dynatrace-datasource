import React, { ChangeEvent, useCallback, useState } from 'react';
import { QueryEditorProps } from '@grafana/data';
import { Button, CodeEditor, ConfirmModal, InlineField, Input, RadioButtonGroup, Stack } from '@grafana/ui';
import { DataSource } from '../datasource';
import { BuilderState, DqlDataSourceOptions, DqlQuery, DqlQueryType, EditorMode } from '../types';
import { DQL_LANGUAGE_ID, registerDqlLanguage } from '../dql/language';
import { SELECTORS } from '../selectors';
import { BuilderEditor } from './BuilderEditor';
import { DEFAULT_BUILDER, dqlFromBuilder } from '../builder';

type Props = QueryEditorProps<DataSource, DqlQuery, DqlDataSourceOptions>;

const QUERY_TYPES: Array<{ label: string; value: DqlQueryType }> = [
  { label: SELECTORS.queryEditor.queryTypeRadios.timeseries, value: 'timeseries' },
  { label: SELECTORS.queryEditor.queryTypeRadios.logs, value: 'logs' },
  { label: SELECTORS.queryEditor.queryTypeRadios.traces, value: 'traces' },
];

const EDITOR_MODES: Array<{ label: string; value: EditorMode }> = [
  { label: 'Builder', value: 'builder' },
  { label: 'Code', value: 'code' },
];

export function QueryEditor({ query, onChange, onRunQuery, datasource }: Props) {
  const queryType: DqlQueryType = query.queryType ?? 'timeseries';
  const editorMode: EditorMode = query.editorMode ?? 'code';
  const [confirmSwitch, setConfirmSwitch] = useState(false);

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

  // Code → Builder: if the user has handwritten DQL that the current
  // builder state wouldn't reproduce, warn before overwriting. The
  // generator is one-way so there's no way to round-trip arbitrary DQL
  // back into the builder.
  const switchToBuilder = useCallback(() => {
    const builder = query.builder ?? DEFAULT_BUILDER;
    const generated = dqlFromBuilder(builder);
    const handwritten = (query.dqlQuery ?? '').trim();
    if (handwritten && handwritten !== generated) {
      setConfirmSwitch(true);
      return;
    }
    onChange({ ...query, editorMode: 'builder', builder, dqlQuery: generated });
  }, [query, onChange]);

  const confirmAndSwitchToBuilder = useCallback(() => {
    const builder = query.builder ?? DEFAULT_BUILDER;
    onChange({ ...query, editorMode: 'builder', builder, dqlQuery: dqlFromBuilder(builder) });
    setConfirmSwitch(false);
  }, [query, onChange]);

  const onModeChange = (value: EditorMode) => {
    if (value === editorMode) {
      return;
    }
    if (value === 'builder') {
      switchToBuilder();
    } else {
      onChange({ ...query, editorMode: 'code' });
    }
  };

  // Builder mutations re-generate DQL on every change. The Monaco editor
  // (hidden in builder mode) tracks the generated value via query.dqlQuery
  // so a switch back to code mode immediately shows the synthesised DQL.
  const onBuilderChange = (builder: BuilderState) => {
    onChange({ ...query, builder, dqlQuery: dqlFromBuilder(builder) });
  };

  return (
    <div>
      <Stack direction="row" gap={1} alignItems="center">
        <InlineField label={SELECTORS.queryEditor.queryTypeLabel} labelWidth={18}>
          <RadioButtonGroup options={QUERY_TYPES} value={queryType} onChange={onTypeChange} />
        </InlineField>
        <InlineField label="Editor" labelWidth={12}>
          <RadioButtonGroup options={EDITOR_MODES} value={editorMode} onChange={onModeChange} />
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

      {editorMode === 'builder' ? (
        <div style={{ marginTop: 8 }}>
          <BuilderEditor value={query.builder ?? DEFAULT_BUILDER} onChange={onBuilderChange} />
          <div
            style={{
              marginTop: 12,
              padding: 8,
              background: 'var(--theme-colors-background-secondary, #1f1f1f)',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
            }}
          >
            {query.dqlQuery || dqlFromBuilder(query.builder ?? DEFAULT_BUILDER)}
          </div>
        </div>
      ) : (
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
      )}

      <ConfirmModal
        isOpen={confirmSwitch}
        title="Switch to Builder"
        body="Your hand-written DQL will be overwritten by the builder's generated query. Proceed?"
        confirmText="Switch and overwrite"
        dismissText="Cancel"
        onConfirm={confirmAndSwitchToBuilder}
        onDismiss={() => setConfirmSwitch(false)}
      />
    </div>
  );
}
