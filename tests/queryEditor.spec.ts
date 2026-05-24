import { test, expect } from '@grafana/plugin-e2e';

test('smoke: should render DQL textarea', async ({ panelEditPage, readProvisionedDataSource }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);
  await expect(panelEditPage.getQueryEditorRow('A').getByLabel('DQL')).toBeVisible();
});
