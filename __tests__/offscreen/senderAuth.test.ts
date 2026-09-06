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
  isNotificationDocumentSender,
} from '@/offscreen/scripts/senderAuth';

const EXT = 'chrome-extension://test-extension-id';

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
          url: `${EXT}/${page}`,
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

  test('REJECTS a URL-less same-extension sender (gpt56 B3)', () => {
    // The round-2/3 tests pinned URL-less acceptance affirmatively. That
    // rule collapsed trust zones: a URL-less message cannot be attributed to
    // the offscreen document, and any same-extension context can omit the
    // URL. Genuine offscreen messages always carry the document URL, so
    // fail-closed here is free.
    expect(isTrustedOffscreenSender({ id: 'test-extension-id' })).toBe(false);
  });

  test('accepts only the exact offscreen document URL for same-extension senders', () => {
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
          url: `${EXT}/${page}`,
        })
      ).toBe(false);
    }
  });

  test('rejects URL-mismatched offscreen look-alikes', () => {
    expect(
      isTrustedOffscreenSender({
        id: 'test-extension-id',
        url: 'chrome-extension://test-extension-id/offscreen.html.evil',
      })
    ).toBe(false);
    expect(
      isTrustedOffscreenSender({
        id: 'test-extension-id',
        url: 'chrome-extension://test-extension-id/sub/offscreen.html',
      })
    ).toBe(false);
  });
});

describe('notification-document sender authentication (gpt56 B3)', () => {
  test('accepts exactly the notification document', () => {
    expect(
      isNotificationDocumentSender({
        id: 'test-extension-id',
        url: `${EXT}/notification.html`,
      })
    ).toBe(true);
    // Query parameters (the per-window close nonce) do not alter document
    // identity.
    expect(
      isNotificationDocumentSender({
        id: 'test-extension-id',
        url: `${EXT}/notification.html?closeNonce=abc123`,
      })
    ).toBe(true);
  });

  test('rejects popup, dashboard/desktop, offscreen, service worker, and index documents', () => {
    for (const page of [
      'popup.html',
      'desktop.html',
      'index.html',
      'offscreen.html',
      'sw.js',
      'background.html',
      'trezor-usb-permissions.html',
    ]) {
      expect(
        isNotificationDocumentSender({
          id: 'test-extension-id',
          url: `${EXT}/${page}`,
        })
      ).toBe(false);
    }
  });

  test('rejects URL-less, tab-bearing (content script), and foreign senders', () => {
    expect(isNotificationDocumentSender(undefined)).toBe(false);
    expect(isNotificationDocumentSender(null)).toBe(false);
    expect(isNotificationDocumentSender({ id: 'test-extension-id' })).toBe(
      false
    );
    expect(
      isNotificationDocumentSender({
        id: 'test-extension-id',
        tab: { id: 3 },
        url: `${EXT}/notification.html`,
      })
    ).toBe(false);
    expect(
      isNotificationDocumentSender({
        id: 'other-extension',
        url: 'chrome-extension://other-extension/notification.html',
      })
    ).toBe(false);
    expect(
      isNotificationDocumentSender({
        id: 'test-extension-id',
        url: 'https://evil.test/notification.html',
      })
    ).toBe(false);
  });
});
