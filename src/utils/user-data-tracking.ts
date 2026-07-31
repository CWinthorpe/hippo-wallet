export const USER_DATA_TRACKING_OPT_OUT_KEY = 'userDataTrackingOptOut';

/**
 * This fork has no runtime analytics mode. The value is compile-time fixed so a
 * migrated preference, UI message, or future call site cannot turn reporting on.
 */
export const PRIVATE_BUILD_TELEMETRY_DISABLED = true as const;

type TrackingPreference = {
  [USER_DATA_TRACKING_OPT_OUT_KEY]?: boolean;
};

export const resetUserDataTrackingCache = () => undefined;

export const updateUserDataTrackingCache = (_preference?: TrackingPreference) =>
  undefined;

export const shouldReportUserBehaviorData = async () => false;
