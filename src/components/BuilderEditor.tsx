import React, { ChangeEvent } from 'react';
import { Button, Combobox, Field as UiField, Input, Select, Stack } from '@grafana/ui';
import type { BuilderState, BuilderFilter, BuilderOperator, BuilderAggFn, BuilderBucket } from '../types';
import {
  BUILDER_AGG_FNS,
  BUILDER_BUCKETS,
  BUILDER_OPERATORS,
  BUILDER_SOURCES,
} from '../builder';

interface Props {
  value: BuilderState;
  onChange: (next: BuilderState) => void;
}

export function BuilderEditor({ value, onChange }: Props) {
  const update = (patch: Partial<BuilderState>) => onChange({ ...value, ...patch });

  return (
    <Stack direction="column" gap={1}>
      <Stack direction="row" gap={2} alignItems="flex-end">
        <UiField label="Data source" description="Grail table to fetch from">
          <Combobox
            width={26}
            options={BUILDER_SOURCES.map((s) => ({ label: s, value: s }))}
            value={{ label: value.source, value: value.source }}
            onChange={(opt) => update({ source: opt?.value ?? value.source })}
            createCustomValue
          />
        </UiField>
        <UiField label="Aggregation">
          <Select
            width={16}
            options={BUILDER_AGG_FNS.map((f) => ({ label: f, value: f }))}
            value={value.aggregation.fn}
            onChange={(opt) =>
              update({ aggregation: { ...value.aggregation, fn: (opt?.value ?? 'count') as BuilderAggFn } })
            }
          />
        </UiField>
        {value.aggregation.fn !== 'count' && (
          <UiField label="Field" description="Numeric field to aggregate">
            <Input
              width={20}
              placeholder="duration"
              value={value.aggregation.field ?? ''}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                update({ aggregation: { ...value.aggregation, field: e.target.value || undefined } })
              }
            />
          </UiField>
        )}
        <UiField label="Time bucket" description="Group by binned timestamp">
          <Select
            width={14}
            options={BUILDER_BUCKETS.map((b) => ({ label: b, value: b }))}
            value={value.bucket}
            onChange={(opt) => update({ bucket: (opt?.value ?? 'auto') as BuilderBucket })}
          />
        </UiField>
      </Stack>

      <FiltersList value={value.filters} onChange={(filters) => update({ filters })} />
      <GroupByList value={value.groupBy} onChange={(groupBy) => update({ groupBy })} />
    </Stack>
  );
}

function FiltersList({
  value,
  onChange,
}: {
  value: BuilderFilter[];
  onChange: (next: BuilderFilter[]) => void;
}) {
  const add = () => onChange([...value, { field: '', operator: '==', value: '' }]);
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const update = (idx: number, patch: Partial<BuilderFilter>) =>
    onChange(value.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  return (
    <Stack direction="column" gap={1}>
      <span style={{ fontSize: 12, color: 'var(--theme-colors-text-secondary, #888)' }}>Filters</span>
      {value.map((f, i) => (
        <Stack key={i} direction="row" gap={1} alignItems="flex-end">
          <UiField label="Field">
            <Input
              width={22}
              placeholder="host.name"
              value={f.field}
              onChange={(e: ChangeEvent<HTMLInputElement>) => update(i, { field: e.target.value })}
            />
          </UiField>
          <UiField label="Op">
            <Select
              width={14}
              options={BUILDER_OPERATORS.map((o) => ({ label: o, value: o }))}
              value={f.operator}
              onChange={(opt) => update(i, { operator: (opt?.value ?? '==') as BuilderOperator })}
            />
          </UiField>
          <UiField label="Value">
            <Input
              width={24}
              placeholder="prod-1"
              value={f.value}
              onChange={(e: ChangeEvent<HTMLInputElement>) => update(i, { value: e.target.value })}
            />
          </UiField>
          <Button variant="destructive" size="sm" icon="trash-alt" onClick={() => remove(i)}>
            Remove
          </Button>
        </Stack>
      ))}
      <Button variant="secondary" size="sm" icon="plus" onClick={add} style={{ alignSelf: 'flex-start' }}>
        Add filter
      </Button>
    </Stack>
  );
}

function GroupByList({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const add = () => onChange([...value, '']);
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const update = (idx: number, v: string) => onChange(value.map((x, i) => (i === idx ? v : x)));

  return (
    <Stack direction="column" gap={1}>
      <span style={{ fontSize: 12, color: 'var(--theme-colors-text-secondary, #888)' }}>Group by</span>
      {value.map((g, i) => (
        <Stack key={i} direction="row" gap={1} alignItems="flex-end">
          <UiField label={`Dimension ${i + 1}`}>
            <Input
              width={28}
              placeholder="service.name"
              value={g}
              onChange={(e: ChangeEvent<HTMLInputElement>) => update(i, e.target.value)}
            />
          </UiField>
          <Button variant="destructive" size="sm" icon="trash-alt" onClick={() => remove(i)}>
            Remove
          </Button>
        </Stack>
      ))}
      <Button variant="secondary" size="sm" icon="plus" onClick={add} style={{ alignSelf: 'flex-start' }}>
        Add group-by dimension
      </Button>
    </Stack>
  );
}
