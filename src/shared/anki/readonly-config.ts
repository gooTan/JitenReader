import {
  DeckConfiguration,
  DiscoverWordConfiguration,
  DiscoverWordConfigurationEntry,
  DiscoverWordConfigurationIssue,
  DiscoverWordConfigurationSource,
  DiscoverWordConfigurationSummary,
  NormalizedDiscoverWordConfiguration,
} from './types';

const normaliseText = (value?: string): string => value?.trim() ?? '';

const normaliseTemplateOrds = (templateOrds?: number[]): number[] => {
  if (!Array.isArray(templateOrds)) {
    return [];
  }

  return Array.from(
    new Set(templateOrds.filter((ord): ord is number => Number.isInteger(ord) && ord >= 0)),
  ).sort((left, right) => left - right);
};

const getEntryId = (config: NormalizedDiscoverWordConfiguration): string =>
  [
    config.model,
    config.wordField,
    config.readingField,
    config.deck,
    config.templateOrds.join(','),
  ].join('\u0000');

const isConfigBlank = ({
  deck,
  model,
  readingField,
  templateOrds,
  wordField,
}: {
  deck?: string;
  model?: string;
  readingField?: string;
  templateOrds?: number[];
  wordField?: string;
}): boolean => {
  return (
    !normaliseText(deck).length &&
    !normaliseText(model).length &&
    !normaliseText(readingField).length &&
    !normaliseText(wordField).length &&
    normaliseTemplateOrds(templateOrds).length === 0
  );
};

const normaliseDiscoverWordConfiguration = (
  rawConfig: DiscoverWordConfiguration,
  source: DiscoverWordConfigurationSource,
  issues: DiscoverWordConfigurationIssue[],
  index?: number,
): DiscoverWordConfigurationEntry | undefined => {
  const config: NormalizedDiscoverWordConfiguration = {
    deck: normaliseText(rawConfig.deck),
    model: normaliseText(rawConfig.model),
    readingField: normaliseText(rawConfig.readingField),
    templateOrds: normaliseTemplateOrds(rawConfig.templateOrds),
    wordField: normaliseText(rawConfig.wordField),
  };

  if (isConfigBlank(config)) {
    return;
  }

  if (!config.model.length) {
    issues.push({ code: 'missing-model', index, source });

    return;
  }

  if (!config.wordField.length) {
    issues.push({ code: 'missing-word-field', index, source });

    return;
  }

  return {
    config,
    id: getEntryId(config),
    source,
  };
};

const deriveDiscoverWordConfiguration = (
  rawConfig: DeckConfiguration,
  source: DiscoverWordConfigurationSource,
  issues: DiscoverWordConfigurationIssue[],
): DiscoverWordConfigurationEntry | undefined => {
  const config: DiscoverWordConfiguration = {
    deck: rawConfig.deck,
    model: rawConfig.model,
    readingField: rawConfig.readingField,
    templateOrds: rawConfig.cardTemplateOrds,
    wordField: rawConfig.wordField,
  };

  return normaliseDiscoverWordConfiguration(config, source, issues);
};

export const getReadonlyDiscoverWordConfigurationSummary = ({
  explicitConfigs,
  blacklistConfig,
  miningConfig,
  neverForgetConfig,
}: {
  explicitConfigs: DiscoverWordConfiguration[];
  blacklistConfig: DeckConfiguration;
  miningConfig: DeckConfiguration;
  neverForgetConfig: DeckConfiguration;
}): DiscoverWordConfigurationSummary => {
  const issues: DiscoverWordConfigurationIssue[] = [];
  const derivedConfigs = [miningConfig, blacklistConfig, neverForgetConfig]
    .map((config) => deriveDiscoverWordConfiguration(config, 'derived', issues))
    .filter((config): config is DiscoverWordConfigurationEntry => config !== undefined);
  const explicitEntries = explicitConfigs
    .map((config, index) => normaliseDiscoverWordConfiguration(config, 'explicit', issues, index))
    .filter((config): config is DiscoverWordConfigurationEntry => config !== undefined);
  const mergedEntries = new Map<string, DiscoverWordConfigurationEntry>();

  for (const config of derivedConfigs) {
    mergedEntries.set(config.id, config);
  }

  for (const config of explicitEntries) {
    mergedEntries.set(config.id, config);
  }

  return {
    explicitConfigs: explicitEntries,
    issues,
    mergedConfigs: Array.from(mergedEntries.values()),
    status: mergedEntries.size > 0 ? 'ready' : 'config-insufficient',
    derivedConfigs,
  };
};
