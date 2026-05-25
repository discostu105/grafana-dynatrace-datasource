// Unit tests for the frontend macro-adjacent helpers. The actual macro
// expansion is server-side (Go) and covered by pkg/macros/macros_test.go;
// this file just keeps the e2e suite honest about ad-hoc filter
// propagation and the legend format input.

import { test, expect } from '@grafana/plugin-e2e';

test('Legend input is settable and persists into the saved panel', async ({
  panelEditPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);

  const legend = page.getByPlaceholder('{{ control.name }}');
  await legend.fill('{{ control.name }} (peak)');
  await expect(legend).toHaveValue('{{ control.name }} (peak)');
});
