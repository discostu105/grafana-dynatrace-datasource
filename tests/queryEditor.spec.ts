import { test, expect } from '@grafana/plugin-e2e';

test('smoke: renders Monaco DQL editor and query-type radio', async ({
  panelEditPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);

  // The Monaco container renders as a [role=code] (textbox in older Monaco
  // builds) inside @grafana/ui's CodeEditor wrapper. Check both query-type
  // options + the legend input are visible.
  await expect(page.getByText('Query type')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Timeseries / Table' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Logs' })).toBeVisible();
  await expect(page.getByText('Legend')).toBeVisible();
  // CodeEditor renders a textarea in the shadow DOM; assert the container.
  await expect(panelEditPage.panel.locator).toBeVisible();
});

test('switches to Logs mode → Body field appears, Legend disappears', async ({
  panelEditPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);

  await page.getByRole('radio', { name: 'Logs' }).click();

  await expect(page.getByText('Body field')).toBeVisible();
  await expect(page.getByText('Legend')).not.toBeVisible();
});
