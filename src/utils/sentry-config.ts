import type { BrowserOptions } from '@sentry/browser';

/**
 * Keep the ErrorBoundary API available without installing handlers or creating
 * a transport. There is intentionally no DSN in the private build.
 */
export const getSentryConfig = (): BrowserOptions => ({
  enabled: false,
  dsn: undefined,
  sendDefaultPii: false,
  skipBrowserExtensionCheck: true,
  integrations: () => [],
  beforeBreadcrumb: () => null,
  beforeSend: async () => null,
});
