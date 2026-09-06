import browser from 'webextension-polyfill';

/**
 * Structural subset of `chrome.runtime.MessageSender` / the polyfill's
 * `Runtime.MessageSender`. Offscreen listeners are registered on the native
 * `chrome.runtime` API in some modules and the polyfill in others, and the
 * two sender types are not mutually assignable, so authenticate structurally.
 */
type SenderLike = {
  id?: string;
  tab?: unknown;
  url?: string;
};

/**
 * Offscreen hardware listeners must only obey messages from the extension's
 * own background context. In MV3 the bridges run in the service worker
 * (`sw.js`); the Trezor proxy in `_raw/sw.js` uses the same exact-URL rule.
 *
 * A same-extension page (popup, notification, desktop, index, pairing popups)
 * or a content script must never be able to drive a signing/init action on an
 * offscreen device bridge: those paths are gated by the provider permission
 * boundary and the approval queue in the background, not by the UI page.
 */
export const isTrustedBackgroundSender = (
  sender?: SenderLike | null
): boolean => {
  if (!sender || sender.id === undefined) {
    return false;
  }
  if (sender.id !== browser.runtime.id) {
    return false;
  }
  // Content scripts and tabs always carry a Tab; reject them.
  if (sender.tab) {
    return false;
  }
  // MV3 service-worker senders may omit `url` in some brokers; allow that.
  if (!sender.url) {
    return true;
  }
  // The MV3 background entrypoint is sw.js. Reject any extension page or
  // offscreen document URL (they end in .html and are not sign drivers).
  return sender.url === browser.runtime.getURL('sw.js');
};

/**
 * Reverse-direction rule: background listeners that receive device events
 * from the offscreen document (bitbox02/ledger/trezor bridges) must only
 * obey messages whose sender is the offscreen document itself — never a tab,
 * a content script, or another extension page. Mirrors the exact-URL rule
 * used by the Trezor browser proxy relay in `_raw/sw.js`.
 *
 * A missing sender URL is NOT acceptable (gpt56 round-3 blocker B3): a
 * URL-less same-extension sender is indistinguishable from one relayed by
 * any other extension context, and every genuine offscreen-document message
 * carries its document URL. Rejecting URL-less senders here is fail-closed
 * and collapses no trust zone.
 */
export const isTrustedOffscreenSender = (
  sender?: SenderLike | null
): boolean => {
  if (!sender || sender.id === undefined) {
    return false;
  }
  if (sender.id !== browser.runtime.id) {
    return false;
  }
  if (sender.tab) {
    return false;
  }
  if (!sender.url) {
    return false;
  }
  return sender.url === browser.runtime.getURL('offscreen.html');
};

/**
 * Only the notification document itself may act on notification-window
 * lifecycle (gpt56 round-3 blocker B3). The previous `isExtensionPageSender`
 * accepted EVERY same-extension page, letting popup/desktop/dashboard — or an
 * offscreen context — declare the approval window closed and suppress the
 * manual-close rejection path. Extension pages are distinct trust zones: the
 * predicate validates the exact expected document path, not membership in
 * the extension. Query parameters (the per-window close nonce) do not alter
 * document identity and are ignored by the path comparison.
 */
export const isNotificationDocumentSender = (
  sender?: SenderLike | null
): boolean => {
  if (!sender || sender.id === undefined) {
    return false;
  }
  if (sender.id !== browser.runtime.id) {
    return false;
  }
  // Extension documents never carry a tab.
  if (sender.tab) {
    return false;
  }
  if (!sender.url) {
    return false;
  }
  try {
    const senderUrl = new URL(sender.url);
    const expectedUrl = new URL(browser.runtime.getURL('notification.html'));
    // The document must live at the extension's own origin (a web page or
    // another extension serving /notification.html is not the notification
    // document); query parameters — the per-window close nonce — are not
    // part of document identity.
    return (
      senderUrl.origin === expectedUrl.origin &&
      senderUrl.pathname === expectedUrl.pathname
    );
  } catch (e) {
    return false;
  }
};
