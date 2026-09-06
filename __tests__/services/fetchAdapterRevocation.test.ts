/**
 * @jest-environment node
 */
// Regressor for gpt56 round-2 blocker B2: the fetch adapter must register its
// AbortController BEFORE awaiting any storage work, and must re-assert the
// remote-data policy after the contact-log write, so a lock/policy change that
// lands mid-request can never be followed by a started network fetch.

const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

jest.mock('background/service/remoteDataPolicy', () => {
  const listeners: Array<() => void> = [];
  let allowed = true;
  const service = {
    assertRequestAllowed: jest.fn(() => {
      if (!allowed) {
        throw Object.assign(new Error('remote data disabled'), {
          code: 'REMOTE_DATA_DISABLED',
        });
      }
    }),
    recordRequestContact: jest.fn(async () => {
      // Simulate the awaited storage write: if the test revokes during it,
      // policy-change listeners fire mid-await (the B2 race window).
      await (service as any).__contactGate;
    }),
    onPolicyChange: jest.fn((fn: () => void) => {
      listeners.push(fn);
    }),
    __setAllowed: (value: boolean) => {
      allowed = value;
    },
    __revoke: () => {
      allowed = false;
      listeners.forEach((fn) => fn());
    },
    __contactGate: Promise.resolve(),
  };
  const isKnownRabbyOrDeBankUrl = (url: string) =>
    url.startsWith('https://api.rabby.io') || url.startsWith('https://api.debank.com');
  return {
    __esModule: true,
    default: service,
    isKnownRabbyOrDeBankUrl,
  };
});

import remoteDataPolicyService from 'background/service/remoteDataPolicy';
import { rabbyOpenapiFetchAdapter } from '@/services/openapi/fetchAdapter';

const requestConfig = {
  url: 'https://custom-openapi.test/v1/data',
  method: 'get' as const,
};

const flush = async () => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

describe('fetch adapter revocation race (B2)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => '{}',
      json: async () => ({}),
    });
    (remoteDataPolicyService as any).__setAllowed(true);
    (remoteDataPolicyService as any).__contactGate = Promise.resolve();
  });

  test('a policy revocation during the contact-log write prevents fetch entirely', async () => {
    let openGate: () => void = () => {};
    (remoteDataPolicyService as any).__contactGate = new Promise<void>(
      (resolve) => {
        openGate = () => resolve();
      }
    );

    const inFlight = rabbyOpenapiFetchAdapter(requestConfig as any);
    // Let the adapter reach the awaited contact-log write.
    await flush();
    await flush();

    // Lock/revocation happens while the storage write is still pending.
    (remoteDataPolicyService as any).__revoke();
    openGate();

    await expect(inFlight).rejects.toThrow(/remote data disabled/i);
    // Decisive assertion: fetch never started after revocation.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('assertRequestAllowed runs again after contact logging (post-write checkpoint)', async () => {
    await rabbyOpenapiFetchAdapter(requestConfig as any);
    const assert = remoteDataPolicyService.assertRequestAllowed as jest.Mock;
    expect(assert.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('a known rabby request revoked mid-write gets its controller aborted pre-fetch', async () => {
    const known = { url: 'https://api.rabby.io/v1/user/x', method: 'get' };
    let openGate: () => void = () => {};
    (remoteDataPolicyService as any).__contactGate = new Promise<void>(
      (resolve) => {
        openGate = () => resolve();
      }
    );

    const inFlight = rabbyOpenapiFetchAdapter(known as any);
    await flush();
    await flush();

    (remoteDataPolicyService as any).__revoke();
    openGate();

    await expect(inFlight).rejects.toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
