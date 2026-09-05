const DEBANK_ORIGINS = new Set([
  'https://debank.com',
  'https://www.debank.com',
]);

export type OpenInDesktopPolicy = {
  source: 'debank';
};

export function getOpenInDesktopPolicy(
  origin?: string
): OpenInDesktopPolicy | null {
  if (origin && DEBANK_ORIGINS.has(origin)) {
    return {
      source: 'debank',
    };
  }

  return null;
}
