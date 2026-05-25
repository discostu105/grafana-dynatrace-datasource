import React, { ChangeEvent } from 'react';
import { Button, Field as UiField, Input, Stack } from '@grafana/ui';
import { DerivedField } from '../types';

interface Props {
  value?: DerivedField[];
  onChange: (next: DerivedField[]) => void;
}

const EMPTY: DerivedField = { name: '', matcherRegex: '', url: '' };

export function DerivedFieldsEditor({ value, onChange }: Props) {
  const rules = value ?? [];

  const update = (idx: number, patch: Partial<DerivedField>) => {
    const next = rules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  };

  const remove = (idx: number) => onChange(rules.filter((_, i) => i !== idx));
  const add = () => onChange([...rules, { ...EMPTY }]);

  return (
    <div style={{ marginTop: 24, maxWidth: 720 }}>
      <h4 style={{ marginBottom: 4 }}>Derived fields</h4>
      <p style={{ marginTop: 0, color: 'var(--theme-colors-text-secondary, #888)', fontSize: 12 }}>
        Regex over the log body adds a clickable button to each matching row. Use the first capture group to extract the
        value; <code>{'${__value.raw}'}</code> substitutes it into the URL. Empty rules are dropped.
      </p>
      <Stack direction="column" gap={1}>
        {rules.map((r, i) => (
          <Stack key={i} direction="row" gap={1} alignItems="flex-end">
            <UiField label="Name">
              <Input
                width={18}
                placeholder="TraceID"
                value={r.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update(i, { name: e.target.value })}
              />
            </UiField>
            <UiField label="Regex">
              <Input
                width={28}
                placeholder="trace[_-]?id=([a-f0-9]+)"
                value={r.matcherRegex}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update(i, { matcherRegex: e.target.value })}
              />
            </UiField>
            <UiField label="URL">
              <Input
                width={36}
                placeholder="https://traces/${__value.raw}"
                value={r.url}
                onChange={(e: ChangeEvent<HTMLInputElement>) => update(i, { url: e.target.value })}
              />
            </UiField>
            <UiField label="Label (optional)">
              <Input
                width={18}
                placeholder="View trace"
                value={r.urlDisplayLabel ?? ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  update(i, { urlDisplayLabel: e.target.value || undefined })
                }
              />
            </UiField>
            <UiField label="Internal DS UID (optional)">
              <Input
                width={20}
                placeholder="tempo-uid"
                value={r.datasourceUid ?? ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  update(i, { datasourceUid: e.target.value || undefined })
                }
              />
            </UiField>
            <Button variant="destructive" size="sm" onClick={() => remove(i)} icon="trash-alt">
              Remove
            </Button>
          </Stack>
        ))}
        <Button variant="secondary" size="sm" icon="plus" onClick={add} style={{ alignSelf: 'flex-start' }}>
          Add derived field
        </Button>
      </Stack>
    </div>
  );
}
