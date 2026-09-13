import { getSentryConfig } from '@/utils/sentry-config';

describe('private-build Sentry configuration', () => {
  const config = getSentryConfig();

  test('has no remote transport or PII collection', () => {
    expect(config.enabled).toBe(false);
    expect(config.dsn).toBeUndefined();
    expect(config.sendDefaultPii).toBe(false);
  });

  test('installs no integrations and drops all events', async () => {
    const filterIntegrations = config.integrations as (
      defaultIntegrations: Array<{ name: string }>
    ) => Array<{ name: string }>;

    expect(filterIntegrations([{ name: 'GlobalHandlers' }])).toEqual([]);
    expect(config.beforeBreadcrumb?.({ category: 'fetch' })).toBeNull();
    await expect(config.beforeSend?.({} as any, {} as any)).resolves.toBeNull();
  });
});
