import { SENTRY_IGNORED_SAMPLES } from '../fixtures/sentry-ignored-samples';
import {
  sanitizeSentryBreadcrumbUrl,
  scrubSentryEvent,
  shouldIgnoreSentryError,
} from '@/utils/sentry';

describe('Sentry ignored errors', () => {
  test.each(SENTRY_IGNORED_SAMPLES)('ignores %s', (message) => {
    expect(shouldIgnoreSentryError(message)).toBe(true);
  });

  // A broken local IndexedDB surfaces as the bare message; only the
  // disk/backing-store flavour is environmental noise.
  test.each([
    'UnknownError: Internal error.',
    'DatabaseClosedError: UnknownError Internal error.',
  ])('keeps the generic IndexedDB failure reportable: %s', (message) => {
    expect(shouldIgnoreSentryError(message)).toBe(false);
  });

  test('still ignores the disk-backed IndexedDB failure', () => {
    expect(
      shouldIgnoreSentryError(
        'UnknownError: Internal error. IO error: .../000041.log: FILE_ERROR_FAILED (ChromeMethodBFE: 3::WritableFileAppend::1)'
      )
    ).toBe(true);
  });

  test('keeps the bounds issue reportable', () => {
    expect(
      shouldIgnoreSentryError(
        'Invalid value for bounds. Bounds must be at least 50% within visible screen space.'
      )
    ).toBe(false);
  });

  test('ignores an expired import stash, thrown or forwarded over the port', () => {
    const thrown = Object.assign(new Error('Wallet import session expired.'), {
      code: 'KEYRING_IMPORT_EXPIRED',
    });
    const forwarded = { message: thrown.message, code: thrown.code };
    expect(shouldIgnoreSentryError(thrown)).toBe(true);
    expect(shouldIgnoreSentryError(forwarded)).toBe(true);
  });

  test('ignores a Request timeout Error', () => {
    expect(shouldIgnoreSentryError(new Error('Request timeout'))).toBe(true);
  });

  test.each([
    new Error('Request failed with status code 500'),
    new TypeError('Load failed'),
  ])('applies anchored ignore rules to Error messages', (error) => {
    expect(shouldIgnoreSentryError(error)).toBe(true);
  });

  test('keeps contextual timeout errors reportable', () => {
    expect(
      shouldIgnoreSentryError(new Error('Request timeout while signing'))
    ).toBe(false);
  });

  test.each([
    'HTTP request failed',
    'HTTP request failed. URL: https://custom-rpc.example',
    'RPC failed: http://127.0.0.1:8545',
    new Error('Request timed out: https://custom-network.example'),
  ])('ignores errors containing http text', (error) => {
    expect(shouldIgnoreSentryError(error)).toBe(true);
  });

  test('does not ignore generic RPC errors without protocol URLs', () => {
    expect(
      shouldIgnoreSentryError(new Error('RPC request failed without URL'))
    ).toBe(false);
  });
});

describe('Stale background forwarded listenCallback errors', () => {
  // Real serialized rejection reported from an old background service worker
  // (background.js line 2, pre-guard build) via Message.onRequest.
  const forwardedStack =
    "TypeError: Cannot read properties of undefined (reading 'apply')\n" +
    '    at o.listenCallback (chrome-extension://acmacodkjbdgmoleebolmdjonilkdbch/background.js:2:10190337)\n' +
    '    at o.onRequest (chrome-extension://acmacodkjbdgmoleebolmdjonilkdbch/background.js:2:11346745)\n' +
    '    at chrome-extension://acmacodkjbdgmoleebolmdjonilkdbch/background.js:2:11347588';

  test('ignores the UI-forwarded copy of an old background error', () => {
    expect(
      shouldIgnoreSentryError({
        message: "Cannot read properties of undefined (reading 'apply')",
        stack: forwardedStack,
      })
    ).toBe(true);
  });

  test('ignores the forwarded copy regardless of background.js line number', () => {
    expect(
      shouldIgnoreSentryError({
        message: 'anything',
        stack:
          '    at s.listenCallback (chrome-extension://id/background.js:4:12040208)',
      })
    ).toBe(true);
  });

  test('keeps a genuine background-origin Error report', () => {
    // setMessageErrorReporter captures real Error instances; those must still
    // be reported even though the stack matches the forwarded signature.
    const realError = new TypeError(
      "Cannot read properties of undefined (reading 'apply')"
    );
    realError.stack = forwardedStack;
    expect(shouldIgnoreSentryError(realError)).toBe(false);
  });

  test('keeps a generic apply error without the listenCallback signature', () => {
    expect(
      shouldIgnoreSentryError({
        message: "Cannot read properties of undefined (reading 'apply')",
        stack:
          "TypeError: Cannot read properties of undefined (reading 'apply')\n" +
          '    at renderDashboard (chrome-extension://id/ui.js:2:12345)',
      })
    ).toBe(false);
  });

  test('keeps a listenCallback error that is not from background.js', () => {
    expect(
      shouldIgnoreSentryError({
        message: 'boom',
        stack:
          '    at o.listenCallback (chrome-extension://id/content-script.js:2:100)',
      })
    ).toBe(false);
  });
});

describe('Sentry breadcrumb privacy', () => {
  test('removes query parameters, fragments, and wallet identifiers', () => {
    expect(
      sanitizeSentryBreadcrumbUrl(
        'https://api.example/account/0x0123456789abcdef0123456789abcdef01234567?token=secret#details'
      )
    ).toBe('https://api.example/account/[redacted]');
  });
});

// Ported from upstream #4248 (feat(sentry): keep token contract ids readable),
// exercised directly on scrubSentryEvent: Hippo strips Sentry initialization and
// ingestion, so the upstream client-driven form of this regressor cannot run
// here, while the shared redaction pipeline in src/utils/sentry.ts is retained.
describe('scrubSentryEvent token-contract exemption (upstream #4248)', () => {
  const user = '0x9bba7ebC9c69db92950def377d732b91bb22d02f';
  const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

  test('keeps a single address under token-contract keys in structured fields', () => {
    const event = {
      tags: { token_id: usdc, owner: user },
      extra: {
        order: {
          fromTokenId: usdc,
          quote: { pay_token_id: usdc, receive_token_id: weth },
          // A loose /token/ match would keep these.
          tokenOwner: user,
          token_holder: user,
          // Only a single, exact address is kept.
          to_token_id: `${usdc},${weth}`,
          token_address: `0x${'0'.repeat(24)}${usdc.slice(2)}`,
          tokenId: 'eth',
        },
      },
      exception: {
        values: [
          {
            type: 'Error',
            // Free text can't say which hex is a token, so all of it is redacted.
            value: `swap failed {"fromTokenId":"${usdc}","owner":"${user}"}`,
          },
        ],
      },
    };

    const scrubbed = scrubSentryEvent(event as any);

    expect(scrubbed.tags.token_id).toBe(usdc);
    expect(scrubbed.extra.order).toEqual({
      fromTokenId: usdc,
      quote: { pay_token_id: usdc, receive_token_id: weth },
      tokenOwner: '[redacted-address]',
      token_holder: '[redacted-address]',
      to_token_id: '[redacted-address],[redacted-address]',
      token_address: '[redacted-hex]',
      tokenId: 'eth',
    });
    expect(scrubbed.exception.values[0].value).toBe(
      'swap failed {"fromTokenId":"[redacted-address]","owner":"[redacted-address]"}'
    );
    // Holder address must not survive anywhere in the serialized event.
    expect(JSON.stringify(scrubbed).toLowerCase()).not.toContain(
      user.slice(2).toLowerCase()
    );
  });

  test('keeps tokenAddress in a structured field but still redacts holder addresses in free text', () => {
    const scrubbed = scrubSentryEvent({
      extra: { tokenAddress: usdc, memo: `${user} sent` },
    } as any);
    expect(scrubbed.extra.tokenAddress).toBe(usdc);
    expect(scrubbed.extra.memo).toBe('[redacted-address] sent');
  });
});
