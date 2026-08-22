import {
  OffscreenCommunicationTarget,
  KnownOrigins,
} from '@/constant/offscreen-communication';
import { isTrustedBackgroundSender } from './senderAuth';

async function openConnectorTab(url: string) {
  const browserTab = window.open(url);
  if (!browserTab) {
    throw new Error('Failed to open Lattice connector.');
  }

  return browserTab;
}

export default function initLattice() {
  /**
   * The main element of the eth-lattice-keyring library that is impacted by MV3
   * is the _openConnectorTab method which is responsible for opening a tab to
   * the lattice connector. This method is called by the _getCreds method of the
   * keyring. In the default keyring this would be attempted inside the service
   * worker which has no DOM and therefore would fail. The solution is to split
   * the functionality so that the openConnectorTab portion operates inside the
   * offscreen document with its DOM. That is what this file is responsible for.
   *
   * When receiving a message from the service worker script targeting the
   * lattice iframe, this listener will execute and open the new tab for
   * connecting to the lattice device. The response from the lattice connector
   * is then sent back to the offscreen bridge for lattice, which extends from
   * the eth-lattice-keyring Keyring class.
   */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (
      msg.target !== OffscreenCommunicationTarget.latticeOffscreen ||
      !isTrustedBackgroundSender(sender)
    ) {
      return;
    }

    // Open the tab
    openConnectorTab(msg.params.url).then((browserTab) => {
      // Watch for the open window closing before creds are sent back
      const listenInterval = setInterval(() => {
        if (browserTab.closed) {
          clearInterval(listenInterval);
          sendResponse({
            error: new Error('Lattice connector closed.'),
          });
        }
      }, 500);

      // On a Chromium browser we can just listen for a window message from the
      // lattice tab (using the event.origin property). When we get that it'll be
      // the response from the lattice connector with the deviceID and password.
      // We can then forward that response to the lattice-offscreen-keyring's
      // _getCreds method using sendResponse API from the chrome runtime.
      const onMessage = (event: MessageEvent) => {
        // Fail closed on BOTH origin and source: only the exact Lattice
        // connector window we just opened may deliver credentials. A message
        // from our own offscreen document (or any other window) with a forged
        // payload must never be treated as device credentials.
        if (
          event.origin !== KnownOrigins.lattice ||
          event.source !== browserTab
        ) {
          return;
        }

        clearInterval(listenInterval);
        window.removeEventListener('message', onMessage, false);

        try {
          // Parse and return creds
          const creds = JSON.parse(event.data);
          if (
            typeof creds?.deviceID !== 'string' ||
            !creds.deviceID ||
            typeof creds?.password !== 'string' ||
            !creds.password
          ) {
            sendResponse({
              error: new Error('Invalid credentials returned from Lattice.'),
            });
            return;
          }
          sendResponse({
            result: creds,
          });
        } catch (err) {
          sendResponse({
            error: err,
          });
        }
      };
      window.addEventListener('message', onMessage, false);
    });

    // eslint-disable-next-line consistent-return
    return true;
  });
}
