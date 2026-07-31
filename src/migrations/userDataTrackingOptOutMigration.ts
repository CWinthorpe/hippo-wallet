import { PreferenceStore } from '@/background/service/preference';

export default {
  version: 11,
  async migrator(data: { preference: PreferenceStore | undefined }) {
    try {
      if (data.preference === undefined) return undefined;

      return {
        preference: {
          ...data.preference,
          userDataTrackingOptOut: true,
        },
      };
    } catch (e) {
      return data;
    }
  },
};
