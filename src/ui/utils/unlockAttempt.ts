/**
 * Window-local unlock attempt (gpt56 round-12 blocker 4).
 *
 * The previous design inferred "this window performed the unlock" from a
 * boolean latch that any local submit could set, while the settlement path
 * was driven by the GLOBAL UNLOCK_WALLET broadcast. A slow/failing local
 * attempt in window A could therefore be "satisfied" by window B's
 * successful unlock broadcast landing while A's latch happened to be set.
 *
 * This module separates the two concerns explicitly:
 *  - beginAttempt(): a local password/biometric submission registers its
 *    attempt with a fresh nonce;
 *  - settleAttempt(): the exact wallet.unlock promise this window awaited
 *    resolves or rejects its OWN attempt, returning proof ({nonce, type})
 *    ONLY for a still-live, still-pending local attempt;
 *  - noteGlobalUnlock(): the global broadcast is transport, never consent —
 *    it only records that the wallet reached the unlocked state (display
 *    routing may consume that), and it CANNOT produce settlement proof.
 *  - Settlement proof is one-shot: consumeProof() hands it out exactly once.
 */

export type UnlockAttemptType = 'Biometrics' | 'Password';

export type UnlockSettlementProof = {
  nonce: number;
  type: UnlockAttemptType;
};

export type WindowUnlockAttemptState = {
  /** True while a local submit is awaiting the background unlock. */
  hasPendingLocalAttempt: () => boolean;
  currentAttemptType: () => UnlockAttemptType | null;
  beginAttempt: (type: UnlockAttemptType) => number;
  /**
   * Called with the outcome of THIS window's own wallet.unlock call.
   * A late settle (nonce already abandoned/failed/superseded) yields null:
   * a stale success must not resurrect settlement.
   */
  settleAttempt: (nonce: number, ok: boolean) => UnlockSettlementProof | null;
  /** Record the global broadcast as display state only; never proof. */
  noteGlobalUnlock: () => void;
  globalUnlockSeen: () => boolean;
  /** Consume the local settlement proof exactly once. */
  consumeProof: () => UnlockSettlementProof | null;
  /** Drop any settled proof (e.g. on component unmount / retry). */
  clearProof: () => void;
};

export const createWindowUnlockAttempt = (): WindowUnlockAttemptState => {
  let nextNonce = 1;
  let pending: { nonce: number; type: UnlockAttemptType } | null = null;
  let proof: UnlockSettlementProof | null = null;
  let globalUnlockSeen = false;

  return {
    hasPendingLocalAttempt: () => pending !== null,
    currentAttemptType: () => pending?.type ?? null,
    beginAttempt: (type) => {
      const nonce = nextNonce++;
      pending = { nonce, type };
      return nonce;
    },
    settleAttempt: (nonce, ok) => {
      // Only the attempt that is STILL the pending one may settle. A failed
      // attempt clears pending, so a later success broadcast for the same
      // nonce can never produce proof.
      if (!pending || pending.nonce !== nonce) {
        return null;
      }
      const type = pending.type;
      pending = null;
      if (!ok) {
        proof = null;
        return null;
      }
      proof = { nonce, type };
      return proof;
    },
    noteGlobalUnlock: () => {
      globalUnlockSeen = true;
    },
    globalUnlockSeen: () => globalUnlockSeen,
    consumeProof: () => {
      const out = proof;
      proof = null;
      return out;
    },
    clearProof: () => {
      proof = null;
    },
  };
};
