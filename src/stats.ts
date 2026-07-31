export type EventParams = Record<string, number | string | boolean | undefined>;

/** Permanent no-op in the private build. */
export default {
  report: async (_name: string, _params: EventParams) => undefined,
};
