import { DeckConfiguration } from './types';

export type AnkiCreatePathCapabilityReason =
  | 'stage12-disabled'
  | 'missing-deck'
  | 'missing-model'
  | 'missing-word-field'
  | 'missing-template-targets';

export type AnkiCreatePathCapability = {
  configured: boolean;
  available: boolean;
  reason: AnkiCreatePathCapabilityReason;
  target?: {
    deck: string;
    model: string;
    readingField: string;
    templateTargetCount: number;
    wordField: string;
  };
};

export function GetAnkiCreatePathCapability(
  miningConfig: DeckConfiguration,
): AnkiCreatePathCapability {
  const deck = miningConfig.deck.trim();
  const model = miningConfig.model.trim();
  const wordField = miningConfig.wordField.trim();
  const readingField = miningConfig.readingField.trim();
  const templateTargetCount = miningConfig.templateTargets.filter((target) => {
    return target.field.trim().length > 0 && target.template.trim().length > 0;
  }).length;

  if (!deck.length) {
    return {
      configured: false,
      available: false,
      reason: 'missing-deck',
    };
  }

  if (!model.length) {
    return {
      configured: false,
      available: false,
      reason: 'missing-model',
    };
  }

  if (!wordField.length) {
    return {
      configured: false,
      available: false,
      reason: 'missing-word-field',
    };
  }

  if (templateTargetCount === 0) {
    return {
      configured: false,
      available: false,
      reason: 'missing-template-targets',
    };
  }

  return {
    configured: true,
    available: false,
    reason: 'stage12-disabled',
    target: {
      deck,
      model,
      readingField,
      templateTargetCount,
      wordField,
    },
  };
}
