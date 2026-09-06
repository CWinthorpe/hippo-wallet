jest.mock('webextension-polyfill', () => ({
  __esModule: true,
  default: {
    runtime: {
      id: 'test-extension-id',
      getURL: (relative: string) =>
        `chrome-extension://test-extension-id/${relative}`,
    },
  },
}));

import {
  isTrustedBackgroundSender,
  isTrustedOffscreenSender,
} from '@/offscreen/scripts/senderAuth';

describe('offscreen sender authentication', () => {
  test('rejects missing, wrong-id, and tab-bearing senders', () => {
    expect(isTrustedBackgroundSender(undefined)).toBe(false);
    expect(isTrustedBackgroundSender(null)).toBe(false);
    expect(isTrustedBackgroundSender({ id: 'other-extension' })).toBe(false);
    expect(
      isTrustedBackgroundSender({
        id: 'test-extension-id',
        tab: { id: 7, url: 'https://evil.example' },
      })
    ).toBe(false);
  });

  test('accepts only the extension service worker context', () => {
    // MV3 service worker senders may carry no URL.
    expect(isTrustedBackgroundSender({ id: 'test-extension-id' })).toBe(true);
    // Explicit service-worker script URL is allowed.
    expect(
      isTrustedBackgroundSender({
        id: 'test-extension-id',
        url: 'chrome-extension://test-extension-id/sw.js',
      })
    ).toBe(true);
  });

  test('rejects same-extension pages and the offscreen document itself', () => {
    for (const page of [
      'popup.html',
      'index.html',
      'notification.html',
      'desktop.html',
      'offscreen.html',
    ]) {
      expect(
        isTrustedBackgroundSender({
          id: 'test-extension-id',
          url: `chrome-extension://test-extension-id/${page}`,
        })
      ).toBe(false);
    }
  });
});

describe('reverse offscreen sender authentication (background receivers)', () => {
  test('rejects missing id, wrong id, and tab-bearing senders', () => {
    expect(isTrustedOffscreenSender(undefined)).toBe(false);
    expect(isTrustedOffscreenSender(null)).toBe(false);
    expect(isTrustedOffscreenSender({ id: 'other-extension' })).toBe(false);
    expect(
      isTrustedOffscreenSender({
        id: 'test-extension-id',
        tab: { id: 7, url: 'https://evil.example' },
      })
    ).toBe(false);
  });

  test('accepts only the exact offscreen document URL for same-extension senders', () => {
    // UV-less same-extension sender: allowed only as the offscreen broker is
    // registered by the SW itself without a URL.
    expect(isTrustedOffscreenSender({ id: 'test-extension-id' })).toBe(true);
    // The offscreen document is the legitimate reverse-channel sender.
    expect(
      isTrustedOffscreenSender({
        id: 'test-extension-id',
        url: 'chrome-extension://test-extension-id/offscreen.html',
      })
    ).toBe(true);
  });

  test('rejects every other extension page as the reverse-channel sender', () => {
    for (const page of [
      'popup.html',
      'index.html',
      'notification.html',
      'desktop.html',
      'sw.js',
      'background.html',
    ]) {
      expect(
        isTrustedOffscreenSender({
          id: 'test-extension-id',
          url: `chrome-extension://test-extension-id/${page}`,
        })
      ).toBe(false);
    }
  });
});
