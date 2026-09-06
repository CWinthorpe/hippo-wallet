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
 * used by the Trezor browser proxcy relay in `_raw/sw.js`.
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
    return true;
  }
  return sender.url === browser.runtime.getURL('offscreen.html');
};

/** Browser-window shutdown for bio-metric unlock setup. */
export const isExtensionPageSender = (sender?: SenderLike | null): boolean => {
  if (!sender || sender.id === undefined) {
    return false;
  }
  if (sender.id !== browser.runtime.id) {
    return false;
  }
  // Content scripts carry a real web URL; extension pages carry the
  // extension's own base URL (popup.html, notification.html, ...).
  if (!sender.url) {
    return true;
  }
  return sender.url.startsWith(browser.runtime.getURL(''));
};
