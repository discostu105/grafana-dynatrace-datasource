// Single source of truth for the visible/aria labels that the config and
// query editors render. Both the React components and the Playwright specs
// import from here so a copy change can't silently desync the two.
//
// Keep this file string-only — it is referenced from `tests/` where we
// can't pull in @grafana/ui or React.
export const SELECTORS = {
  configEditor: {
    tenantUrlLabel: 'Tenant URL',
    apiTokenLabel: 'API token',
    queryTimeoutLabel: 'Query timeout (s)',
    defaultTimeframeLabel: 'Default timeframe',
  },
  queryEditor: {
    queryTypeLabel: 'Query type',
    queryTypeRadios: {
      timeseries: 'Timeseries / Table',
      logs: 'Logs',
    },
    legendLabel: 'Legend',
    bodyFieldLabel: 'Body field',
    runButtonLabel: 'Run',
  },
} as const;
