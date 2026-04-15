type ParserFeatureFlags = {
  stableVisibleParseQueue: boolean;
};

type ParserFeatureFlagKey = keyof ParserFeatureFlags;

declare global {
  interface Window {
    __JITEN_INTERNAL_FLAGS__?: Partial<ParserFeatureFlags>;
  }
}

const parserFeatureFlagDefaults: ParserFeatureFlags = {
  stableVisibleParseQueue: true,
};

export const isParserFeatureEnabled = (flag: ParserFeatureFlagKey): boolean => {
  if (typeof window === 'undefined') {
    return parserFeatureFlagDefaults[flag];
  }

  return window.__JITEN_INTERNAL_FLAGS__?.[flag] ?? parserFeatureFlagDefaults[flag];
};
