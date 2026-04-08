export type AnkiFieldTemplateName =
  | 'empty'
  | 'spelling'
  | 'reading'
  | 'isKanji'
  | 'meaning'
  | 'sentence'
  | 'sentenceSanitized'
  | 'sound:silence'
  | 'hiragana'
  | 'frequency'
  | 'frequencyStylized';

export type TemplateTarget = {
  template: AnkiFieldTemplateName;
  field: string;
};

export type DeckConfiguration = {
  deck: string;
  model: string;
  proxy: boolean;
  wordField: string;
  readingField: string;
  cardTemplateOrds: number[];
  templateTargets: TemplateTarget[];
};

export type DiscoverWordConfiguration = {
  model: string;
  wordField: string;
  deck?: string;
  readingField?: string;
  templateOrds?: number[];
};

export type NormalizedDiscoverWordConfiguration = {
  deck: string;
  model: string;
  readingField: string;
  templateOrds: number[];
  wordField: string;
};

export type DiscoverWordConfigurationSource = 'derived' | 'explicit';

export type DiscoverWordConfigurationEntry = {
  config: NormalizedDiscoverWordConfiguration;
  id: string;
  source: DiscoverWordConfigurationSource;
};

export type DiscoverWordConfigurationIssue = {
  code: 'missing-model' | 'missing-word-field';
  index?: number;
  source: DiscoverWordConfigurationSource;
};

export type DiscoverWordConfigurationSummary = {
  explicitConfigs: DiscoverWordConfigurationEntry[];
  issues: DiscoverWordConfigurationIssue[];
  mergedConfigs: DiscoverWordConfigurationEntry[];
  status: 'ready' | 'config-insufficient';
  derivedConfigs: DiscoverWordConfigurationEntry[];
};
