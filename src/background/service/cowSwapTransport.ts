import { COW_SWAP_API_BASE_URLS } from '@/constant/cow-swap';

export type CowSwapTransportMethod = 'GET' | 'POST' | 'DELETE';

export interface CowSwapTransportRequest {
  url: string;
  method: CowSwapTransportMethod;
  body?: string;
  timeoutMs?: number;
}

export interface CowSwapTransportResponse {
  status: number;
  text: string;
  contentType: string;
}

export type CowSwapTransport = (
  request: CowSwapTransportRequest
) => Promise<CowSwapTransportResponse>;

export const COW_SWAP_MAX_RESPONSE_BYTES = 512 * 1024;
export const COW_SWAP_DEFAULT_TIMEOUT_MS = 15_000;

const ORDER_UID_PATTERN = /^0x[0-9a-f]{112}$/;

const getAllowedApiBase = (url: URL) => {
  return [...COW_SWAP_API_BASE_URLS].find((baseUrl) => {
    const base = new URL(baseUrl);
    return (
      url.origin === base.origin &&
      (url.pathname === base.pathname ||
        url.pathname.startsWith(`${base.pathname}/`))
    );
  });
};

const validateTransportRequest = ({
  url: rawUrl,
  method,
  body,
}: CowSwapTransportRequest) => {
  const url = new URL(rawUrl);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid CoW Swap API URL');
  }

  const baseUrl = getAllowedApiBase(url);
  if (!baseUrl) throw new Error('Unapproved CoW Swap API origin or network');
  const base = new URL(baseUrl);
  const relativePath = url.pathname.slice(base.pathname.length);
  const isQuote = method === 'POST' && relativePath === '/api/v1/quote';
  const isOrderSubmission =
    method === 'POST' && relativePath === '/api/v1/orders';
  const isCancellation =
    method === 'DELETE' && relativePath === '/api/v1/orders';
  const orderUid = relativePath.match(
    /^\/api\/v1\/orders\/(0x[0-9a-f]{112})$/
  )?.[1];
  const isOrderRead =
    method === 'GET' && !!orderUid && ORDER_UID_PATTERN.test(orderUid);

  if (!isQuote && !isOrderSubmission && !isCancellation && !isOrderRead) {
    throw new Error('Unapproved CoW Swap API method or path');
  }
  if (method === 'GET' ? body !== undefined : typeof body !== 'string') {
    throw new Error('Invalid CoW Swap API request body');
  }
  if (body && new TextEncoder().encode(body).byteLength > 128 * 1024) {
    throw new Error('CoW Swap API request body is too large');
  }

  return url.toString();
};

const readBoundedText = async (response: Response, maxBytes: number) => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('CoW Swap API response is too large');
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('CoW Swap API response is too large');
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
};

export const fetchCowSwapApi: CowSwapTransport = async (request) => {
  const url = validateTransportRequest(request);
  const timeoutMs = request.timeoutMs ?? COW_SWAP_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error('Invalid CoW Swap API timeout');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: request.method,
      headers: {
        Accept: 'application/json',
        ...(request.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      body: request.body,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const text = await readBoundedText(response, COW_SWAP_MAX_RESPONSE_BYTES);
    const contentType = response.headers.get('content-type') || '';
    if (
      response.ok &&
      text &&
      !/^application\/json(?:\s*;|$)/i.test(contentType)
    ) {
      throw new Error('CoW Swap API returned a non-JSON response');
    }
    return { status: response.status, text, contentType };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('CoW Swap API request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const __cowSwapTransportTestUtils = {
  validateTransportRequest,
  readBoundedText,
};
