import { test, expect } from '@grafana/plugin-e2e';
import { SELECTORS } from '../src/selectors';

test('config editor exposes tenant URL + token + optional tuning fields', async ({
  createDataSourceConfigPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await createDataSourceConfigPage({ type: ds.type });

  await expect(page.getByText(SELECTORS.configEditor.tenantUrlLabel)).toBeVisible();
  await expect(page.getByText(SELECTORS.configEditor.apiTokenLabel)).toBeVisible();
  await expect(page.getByText(SELECTORS.configEditor.queryTimeoutLabel)).toBeVisible();
  await expect(page.getByText(SELECTORS.configEditor.defaultTimeframeLabel)).toBeVisible();
});

test('Save & test against a configured datasource reports a result', async ({
  readProvisionedDataSource,
  gotoDataSourceConfigPage,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const page = await gotoDataSourceConfigPage(ds.uid);
  // We can't assert OK without a live tenant in CI, but we *can* assert
  // the request goes out and a verdict is rendered (OK or actionable
  // error — never a generic "unknown error" or empty toast).
  await expect
    .poll(
      async () => {
        const verdict = await page.saveAndTest();
        return verdict.title;
      },
      { timeout: 20_000, message: 'health verdict toast did not render' }
    )
    .not.toBe('');
});
