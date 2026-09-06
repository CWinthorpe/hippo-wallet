import remoteDataPolicyService from 'background/service/remoteDataPolicy';

/**
 * Direct feedback-image transport (gpt56 round-3 blocker B2).
 *
 * This upload bypasses the axios fetch adapter, so it must carry the same
 * revocation safety the adapter has: the AbortController is registered
 * BEFORE the awaited contact-log write, a policy-change listener aborts
 * registered requests, and the authorization is re-asserted immediately
 * before the fetch starts. Revoking feedback consent while the storage
 * write is pending — even when another Rabby/DeBank capability remains
 * enabled and no blanket DNR rule is installed — must make the request
 * fail closed without the image bytes ever leaving the device.
 */

const activeFeedbackUploadControllers = new Set<AbortController>();

remoteDataPolicyService.onPolicyChange(() => {
  activeFeedbackUploadControllers.forEach((controller) => controller.abort());
  activeFeedbackUploadControllers.clear();
});

export const FEEDBACK_UPLOAD_ENDPOINT =
  'https://api.rabby.io/v1/feedback/app/upload';

export const uploadRemoteFeedbackImage = async ({
  dataUrl,
  filename,
}: {
  dataUrl: string;
  filename: string;
}) => {
  const endpoint = FEEDBACK_UPLOAD_ENDPOINT;
  remoteDataPolicyService.assertRequestAllowed(endpoint, true);

  // Registration precedes every await in this function: a lock/revocation
  // that lands while the contact-log storage write is pending must find
  // this controller.
  const controller = new AbortController();
  activeFeedbackUploadControllers.add(controller);

  try {
    await remoteDataPolicyService.recordRequestContact(endpoint, true);

    const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error('Invalid screenshot payload');
    const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
    const formData = new FormData();
    formData.append('file', new Blob([bytes], { type: match[1] }), filename);

    // Final consent checkpoint immediately before the network sink: if
    // feedback consent was revoked during the contact-log write or payload
    // preparation, fail closed instead of fetching under stale consent.
    remoteDataPolicyService.assertRequestAllowed(endpoint, true);
    if (controller.signal.aborted) {
      throw new Error(
        'Feedback upload cancelled: remote data consent changed during the request'
      );
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Feedback upload failed (${response.status})`);
    }
    const result = await response.json();
    if (!result?.image_url || typeof result.image_url !== 'string') {
      throw new Error('Invalid feedback upload response');
    }
    return result.image_url as string;
  } finally {
    activeFeedbackUploadControllers.delete(controller);
  }
};
