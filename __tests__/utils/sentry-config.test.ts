import { getSentryConfig } from '@/utils/sentry-config';
import { applySigningContext, attachSigningContext } from '@/utils/sentry';
import type { SigningOperation } from '@/background/service/keyring/signing-diagnostics';

const attachHardwareSigningContext = (
  error: unknown,
  context: {
    wallet: string;
    operation: string;
    originalError?: unknown;
    error_category?: 'user_cancelled' | 'unknown';
    provider_code?: string;
    provider_error_tag?: string;
    provider_stage?: string;
    provider_reason?: string;
    provider_metadata?: Record<string, string | number | boolean>;
  }
) =>
  attachSigningContext(error, {
    schema_version: 1,
    wallet_family: 'hardware',
    wallet_provider: context.wallet,
    transport: 'unknown',
    operation: (context.operation === 'message'
      ? 'personal_message'
      : context.operation) as SigningOperation,
    stage: 'sign',
    outcome: 'failed',
    error_category: context.error_category ?? 'unknown',
    duration_bucket: 'lt_100ms',
    provider_code: context.provider_code,
    provider_error_tag: context.provider_error_tag,
    provider_stage: context.provider_stage,
    provider_reason: context.provider_reason,
    provider_metadata: context.provider_metadata,
    originalError: context.originalError,
  });

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

  // Upstream #4068 regression coverage retained as pure-function tests: the
  // canonicalization helpers ship in the bundle (signing-diagnostics wiring),
  // and their grouping/dedup semantics must not silently regress even while
  // the private build performs no remote reporting.
  test('preserves the parsed stacktrace when canonicalizing signing errors', () => {
    const error = new Error('device failed');
    attachHardwareSigningContext(error, {
      wallet: 'ledger',
      operation: 'transaction',
    });
    const stacktrace = { frames: [{ filename: 'signer.ts', lineno: 42 }] };
    const event: any = {
      exception: {
        values: [{ type: 'Error', value: error.message, stacktrace }],
      },
    };

    applySigningContext(event, error);

    expect(event.exception.values[0]).toMatchObject({
      type: 'SigningError',
      value: 'unknown',
      stacktrace,
    });
  });

  test('uses the safe provider code in the canonical exception and grouping', () => {
    const error = new Error('device failed');
    attachHardwareSigningContext(error, {
      wallet: 'ledger',
      operation: 'transaction',
      provider_code: '0x6985',
      provider_error_tag: 'EthAppCommandError',
      provider_stage: 'signer.eth.steps.signTransaction',
      provider_reason: 'condition_not_satisfied',
      provider_metadata: {
        status_word: '0x6985',
        last_required_user_interaction: 'sign-transaction',
        used_fallback: false,
      },
    });
    const event: any = {
      exception: { values: [{ type: 'Error', value: error.message }] },
    };

    applySigningContext(event, error);

    expect(event.exception.values[0]).toMatchObject({
      type: 'SigningError',
      value: '0x6985',
    });
    expect(event.tags).toMatchObject({
      signing_provider_code: '0x6985',
      signing_provider_error_tag: 'EthAppCommandError',
      signing_provider_stage: 'signer.eth.steps.signTransaction',
    });
    expect(event.fingerprint).toContain('0x6985');
    expect(event.extra).toMatchObject({
      signing_provider_code: '0x6985',
      signing_provider_error_tag: 'EthAppCommandError',
      signing_provider_reason: 'condition_not_satisfied',
      signing_provider_metadata: {
        last_required_user_interaction: 'sign-transaction',
        used_fallback: false,
      },
    });
  });
});
