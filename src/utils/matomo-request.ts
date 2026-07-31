export type MatomoEvent = {
  category: string;
  action: string;
  label?: string;
  value?: number;
  transport?: any;
};

/** Permanent no-op in the private build. */
export const matomoRequestEvent = async (_data: MatomoEvent) => undefined;
