import { DeckConfiguration } from './types';
import { AnkiWriteTargetIssueCode, ResolveAnkiWriteTarget } from './write-target';

export type AnkiCreatePathCapabilityReason = 'ready' | AnkiWriteTargetIssueCode;

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
  const resolution = ResolveAnkiWriteTarget(miningConfig);

  if (!resolution.available) {
    return {
      configured: false,
      available: false,
      reason: resolution.reason,
    };
  }

  return {
    configured: true,
    available: true,
    reason: 'ready',
    target: {
      deck: resolution.target.deck,
      model: resolution.target.model,
      readingField: resolution.target.readingField,
      templateTargetCount: resolution.target.templateTargets.length,
      wordField: resolution.target.wordField,
    },
  };
}
