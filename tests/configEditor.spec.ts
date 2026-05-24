import { test, expect } from '@grafana/plugin-e2e';

test('smoke: should render env-var info in config editor', async ({
  createDataSourceConfigPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await createDataSourceConfigPage({ type: ds.type });
  await expect(page.getByText('DT_TENANT_URL')).toBeVisible();
});
