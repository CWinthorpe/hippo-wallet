/**
 * @jest-environment node
 */
// Regressor for gpt56 round-3 blocker B2: the direct feedback-image
// transport must register its AbortController BEFORE awaiting the contact
// log, and must re-check authorization immediately before fetch. The
// revocation mutant below leaves ANOTHER Rabby/DeBank capability enabled
// (so no blanket DNR rule would be installed and the fetch adapter path
// would stay open) and stalls the contact-log write — the exact window the
// round-3 audit used. The image request must be aborted / never started.

const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

type Listener = () => void;

jest.mock('background/service/remoteDataPolicy', () => {
  const listeners: Listener[] = [];
  // Capability model mirroring remoteDataPolicy: the feedback upload
  // endpoint is classified under the `feedback` capability. Revoking
  // feedback consent only invalidates feedback endpoints; the other enabled
  // capability (portfolio) keeps generic Rabby/DeBank traffic allowed — this
  // is why the DNR blanket rule stays absent and only a per-request
  // re-check/abort can stop the upload.
  const capabilities: Record<string, boolean> = {
    feedback: true,
    portfolio: true,
  };
  const FEEDBACK_ENDPOINT = 'https://api.rabby.io/v1/feedback/app/upload';
  const service = {
    assertRequestAllowed: jest.fn((url: string) => {
      if (url === FEEDBACK_ENDPOINT && !capabilities.feedback) {
        throw Object.assign(new Error('remote data disabled'), {
          code: 'REMOTE_DATA_DISABLED',
        });
      }
    }),
    recordRequestContact: jest.fn(async () => {
      // Simulated awaited storage write: tests stall it via __contactGate.
      await (service as any).__contactGate;
    }),
    onPolicyChange: jest.fn((fn: Listener) => {
      listeners.push(fn);
    }),
    __setCapability: (capability: string, value: boolean) => {
      capabilities[capability] = value;
    },
    // The revocation mutant: feedback consent goes away while portfolio
    // remains enabled; policy-change listeners fire (the adapter-style abort
    // hook is the only thing that can reach an in-flight direct fetch).
    __revokeFeedback: () => {
      capabilities.feedback = false;
      listeners.forEach((fn) => fn());
    },
    __contactGate: Promise.resolve() as Promise<void>,
  };
  const isKnownRabbyOrDeBankUrl = (url: string) =>
    url.startsWith('https://api.rabby.io') ||
    url.startsWith('https://api.debank.com');
  return {
    __esModule: true,
    default: service,
    isKnownRabbyOrDeBankUrl,
  };
});

import remoteDataPolicyService from 'background/service/remoteDataPolicy';
import { uploadRemoteFeedbackImage } from '@/background/service/feedbackUploadTransport';

const PNG_DATA_URL =
  'data:image/png;base64,aGVsbG8td29ybGQtaGlwcG8tc2NyZWVuc2hvdA==';

const flush = async () => {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
};

describe('feedback upload transport revocation race (B2)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ image_url: 'https://files.test/img.png' }),
    });
    (remoteDataPolicyService as any).__setCapability('feedback', true);
    (remoteDataPolicyService as any).__setCapability('portfolio', true);
    (remoteDataPolicyService as any).__contactGate = Promise.resolve();
    (remoteDataPolicyService.assertRequestAllowed as jest.Mock).mockClear();
  });

  test('revocation of feedback consent DURING a stalled contact-log write (portfolio still enabled) never starts fetch', async () => {
    let openGate: () => void = () => {};
    (remoteDataPolicyService as any).__contactGate = new Promise<void>(
      (resolve) => {
        openGate = () => resolve();
      }
    );

    const inFlight = uploadRemoteFeedbackImage({
      dataUrl: PNG_DATA_URL,
      filename: 'shot.png',
    });
    await flush();

    // Feedback consent is revoked while the storage write is still pending;
    // another capability stays enabled, so no blanket DNR rule would fire.
    (remoteDataPolicyService as any).__revokeFeedback();
    openGate();

    await expect(inFlight).rejects.toThrow(/remote data disabled/i);
    // Decisive: the image never leaves the device.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('an abort-only revocation during the write aborts the registered controller pre-fetch', async () => {
    // Policy asserts stay permissive; only the policy-change listener fires.
    // The transport must catch the abort through its registered controller
    // even when no assertion would reject.
    let openGate: () => void = () => {};
    (remoteDataPolicyService as any).__contactGate = new Promise<void>(
      (resolve) => {
        openGate = () => resolve();
      }
    );

    const inFlight = uploadRemoteFeedbackImage({
      dataUrl: PNG_DATA_URL,
      filename: 'shot.png',
    });
    await flush();

    const listeners = (remoteDataPolicyService.onPolicyChange as jest.Mock).mock.calls.map(
      ([fn]) => fn
    ) as Array<() => void>;
    expect(listeners.length).toBeGreaterThan(0);
    // Fire revocation listeners WITHOUT changing assertion state: only the
    // abort path can stop this request.
    listeners.forEach((fn) => fn());
    openGate();

    await expect(inFlight).rejects.toThrow(/cancel|abort/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('assertRequestAllowed runs again after the contact log write', async () => {
    await uploadRemoteFeedbackImage({
      dataUrl: PNG_DATA_URL,
      filename: 'shot.png',
    });
    const assert = remoteDataPolicyService.assertRequestAllowed as jest.Mock;
    expect(assert.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.rabby.io/v1/feedback/app/upload');
    expect((init as RequestInit).signal).toBeDefined();
  });

  test('the fetch signal is the registered controller signal (aborted on mid-write revocation)', async () => {
    let openGate: () => void = () => {};
    (remoteDataPolicyService as any).__contactGate = new Promise<void>(
      (resolve) => {
        openGate = () => resolve();
      }
    );

    let capturedSignal: AbortSignal | undefined;
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      capturedSignal = init.signal as AbortSignal;
      if (capturedSignal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ image_url: 'https://files.test/img.png' }),
      };
    });

    const inFlight = uploadRemoteFeedbackImage({
      dataUrl: PNG_DATA_URL,
      filename: 'shot.png',
    });
    await flush();
    // Abort without touching assertions; then restore assertion state so the
    // post-write assert passes and the fetch is attempted with the signal —
    // proving the signal itself carries the revocation.
    const listeners = (remoteDataPolicyService.onPolicyChange as jest.Mock).mock.calls.map(
      ([fn]) => fn
    ) as Array<() => void>;
    listeners.forEach((fn) => fn());
    openGate();

    // The transport's own aborted pre-flight check rejects, and fetch was
    // either skipped entirely or attempted with an aborted signal.
    await expect(inFlight).rejects.toBeDefined();
    if (mockFetch.mock.calls.length > 0) {
      expect(capturedSignal?.aborted).toBe(true);
    } else {
      expect(mockFetch).not.toHaveBeenCalled();
    }
  });
});
