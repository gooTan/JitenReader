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

/**
 * Determine whether an Anki create-path operation is available for the given deck configuration.
 *
 * Evaluates the resolved Anki write target and reports whether creation is configured and ready. When ready, the returned capability includes the resolved target details and the count of template targets.
 *
 * @param miningConfig - The deck configuration to evaluate for Anki write capability
 * @returns An `AnkiCreatePathCapability` describing whether creation is configured and available. If `available` is `true`, `target` contains `deck`, `model`, `readingField`, `wordField`, and `templateTargetCount`; if `available` is `false`, `reason` indicates why creation is not available.
 */
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
