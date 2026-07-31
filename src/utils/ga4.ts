type AnalyticsParams = {
  session_id?: string;
  engagement_time_msec?: number;
  event_category?: string;
  [key: string]: any;
};

/**
 * Compatibility facade for existing call sites. Private builds never create a
 * client identifier, session identifier, or network request.
 */
class Analytics {
  async fireEvent(_name: string, _params: AnalyticsParams = {}) {
    return undefined;
  }

  async firePageViewEvent(_params: {
    pageTitle?: string;
    pageLocation: string;
    additionalParams?: Record<string, any>;
  }) {
    return undefined;
  }

  async fireErrorEvent(
    _error: unknown,
    _additionalParams: Record<string, any> = {}
  ) {
    return undefined;
  }
}

export const ga4 = new Analytics();
