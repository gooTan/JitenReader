import { AnkiCardInfo, AnkiNoteInfo } from '@shared/anki/api.types';
import {
  JitenCardState,
  ReviewTargetCandidateSummary,
  ReviewTargetMetadata,
} from '@shared/jiten/types';
import { getPlanKey, normaliseReadingValue, normaliseTextValue } from './anki-read-planner';
import {
  ANKI_MATURE_INTERVAL_DAYS,
  ANKI_QUEUE_MANUALLY_BURIED,
  ANKI_QUEUE_NEW,
  ANKI_QUEUE_SIBLING_BURIED,
  ANKI_QUEUE_SUSPENDED,
} from './anki-review-backend.constants';
import {
  AnkiTargetCandidate,
  LookupConfig,
  TermContext,
} from './anki-review-backend.internal-types';
import { ReviewTermResolution } from './review-backend.types';

type ResolveTermFromIndexesArgs = {
  termContext: TermContext;
  lookupConfigs: LookupConfig[];
  noteIdsByPlanKey: Map<string, number[]>;
  notesById: Map<number, AnkiNoteInfo>;
  cardsById: Map<number, AnkiCardInfo>;
  intervalsByCardId: Map<number, number>;
  getTemplateName: (modelName: string, ord: number) => string | undefined;
  isCardDue: (card: Pick<AnkiCardInfo, 'queue' | 'due'>) => boolean;
};

export function resolveTermFromIndexes({
  termContext,
  lookupConfigs,
  noteIdsByPlanKey,
  notesById,
  cardsById,
  intervalsByCardId,
  getTemplateName,
  isCardDue,
}: ResolveTermFromIndexesArgs): ReviewTermResolution {
  const candidates: AnkiTargetCandidate[] = [];
  const seenTargets = new Set<string>();

  for (const lookupConfig of lookupConfigs) {
    const planKey = getPlanKey(termContext.termKey, lookupConfig.id);
    const noteIds = noteIdsByPlanKey.get(planKey) ?? [];

    for (const noteId of noteIds) {
      const note = notesById.get(noteId);

      if (note?.modelName !== lookupConfig.model) {
        continue;
      }

      const wordValue = normaliseTextValue(note.fields[lookupConfig.wordField]?.value ?? '');

      if (wordValue !== termContext.normalisedSpelling) {
        continue;
      }

      if (lookupConfig.readingField.length) {
        const noteReading = normaliseReadingValue(
          note.fields[lookupConfig.readingField]?.value ?? '',
        );

        if (noteReading !== termContext.normalisedReading) {
          continue;
        }
      }

      for (const cardId of note.cards) {
        const card = cardsById.get(cardId);

        if (!card) {
          continue;
        }

        if (lookupConfig.deck.length && card.deckName !== lookupConfig.deck) {
          continue;
        }

        if (card.modelName !== lookupConfig.model) {
          continue;
        }

        if (lookupConfig.templateOrds.length && !lookupConfig.templateOrds.includes(card.ord)) {
          continue;
        }

        const due = isCardDue(card);
        const stateTags = getStateTags(card.queue, due, intervalsByCardId.get(card.cardId));
        const templateName = getTemplateName(card.modelName, card.ord);
        const candidate: AnkiTargetCandidate = {
          target: {
            key: `anki:${card.cardId}`,
            wordId: termContext.vocabulary.wordId,
            readingIndex: termContext.vocabulary.readingIndex,
            ankiNoteId: card.note,
            ankiCardId: card.cardId,
            ankiDeck: card.deckName,
            ankiModel: card.modelName,
            ankiTemplateOrd: card.ord,
            ankiTemplateName: templateName,
          },
          stateTags,
          dueState: due ? 'due' : 'notDue',
        };

        if (seenTargets.has(candidate.target.key)) {
          continue;
        }

        candidates.push(candidate);
        seenTargets.add(candidate.target.key);
      }
    }
  }

  if (candidates.length === 0) {
    return createUnmappedResolution();
  }

  if (candidates.length > 1) {
    const hasDueCandidate = candidates.some((candidate) => candidate.dueState === 'due');
    const mergedStateTags = mergeAmbiguousStateTags(candidates);

    if (hasDueCandidate && !mergedStateTags.includes(JitenCardState.DUE)) {
      mergedStateTags.unshift(JitenCardState.DUE);
    }

    return {
      stateTags: mergedStateTags,
      resolutionStatus: 'resolved',
      mappingOutcome: 'ambiguous',
      dueState: hasDueCandidate ? 'due' : 'notDue',
      diagnostics: {
        candidateCount: candidates.length,
        candidateSummary: candidates.map((candidate) => toCandidateSummary(candidate.target)),
      },
    };
  }

  const [candidate] = candidates;

  return {
    stateTags: candidate.stateTags,
    resolutionStatus: 'resolved',
    mappingOutcome: 'selected',
    dueState: candidate.dueState,
    target: candidate.target,
  };
}

export function getStateTagsForCard(
  card: Pick<AnkiCardInfo, 'queue'>,
  intervalDays: number | undefined,
  due: boolean,
): JitenCardState[] {
  return getStateTags(card.queue, due, intervalDays);
}

export function createUnavailableResolution(): ReviewTermResolution {
  return {
    stateTags: [],
    resolutionStatus: 'backend-unavailable',
    dueState: 'unavailable',
  };
}

export function createUnmappedResolution(): ReviewTermResolution {
  return {
    stateTags: [JitenCardState.NEW],
    resolutionStatus: 'resolved',
    mappingOutcome: 'none',
    dueState: 'unknown',
  };
}

export function createConfigInsufficientResolution(): ReviewTermResolution {
  return {
    stateTags: [],
    resolutionStatus: 'config-insufficient',
    dueState: 'unknown',
  };
}

function toCandidateSummary(target: ReviewTargetMetadata): ReviewTargetCandidateSummary {
  return {
    ankiCardId: target.ankiCardId ?? 0,
    ankiDeck: target.ankiDeck ?? '',
    ankiModel: target.ankiModel ?? '',
    ankiTemplateName: target.ankiTemplateName,
    ankiTemplateOrd: target.ankiTemplateOrd ?? 0,
  };
}

function getStateTags(queue: number, due: boolean, intervalDays?: number): JitenCardState[] {
  const stateTags: JitenCardState[] = [];
  const blockedState = getBlockedState(queue);
  const schedulingState = blockedState ? undefined : getSchedulingState(queue, intervalDays);

  if (due) {
    stateTags.push(JitenCardState.DUE);
  }

  if (blockedState) {
    stateTags.push(blockedState);
  }

  if (schedulingState) {
    stateTags.push(schedulingState);
  }

  return stateTags;
}

function getBlockedState(queue: number): JitenCardState | undefined {
  if (queue === ANKI_QUEUE_SUSPENDED) {
    return JitenCardState.SUSPENDED;
  }

  if (queue === ANKI_QUEUE_SIBLING_BURIED || queue === ANKI_QUEUE_MANUALLY_BURIED) {
    return JitenCardState.BURIED;
  }
}

function getSchedulingState(queue: number, intervalDays?: number): JitenCardState | undefined {
  if (queue === ANKI_QUEUE_NEW) {
    return JitenCardState.NEW;
  }

  if (typeof intervalDays !== 'number' || !Number.isFinite(intervalDays)) {
    return;
  }

  return intervalDays >= ANKI_MATURE_INTERVAL_DAYS ? JitenCardState.MATURE : JitenCardState.YOUNG;
}

function mergeAmbiguousStateTags(candidates: AnkiTargetCandidate[]): JitenCardState[] {
  const hasDueCandidate = candidates.some((candidate) => candidate.dueState === 'due');
  const hasSuspendedCandidate = candidates.some((candidate) =>
    candidate.stateTags.includes(JitenCardState.SUSPENDED),
  );
  const hasBuriedCandidate = candidates.some((candidate) =>
    candidate.stateTags.includes(JitenCardState.BURIED),
  );
  const maturityStates = new Set<JitenCardState>();

  for (const candidate of candidates) {
    if (candidate.stateTags.includes(JitenCardState.NEW)) {
      maturityStates.add(JitenCardState.NEW);
    }

    if (candidate.stateTags.includes(JitenCardState.MATURE)) {
      maturityStates.add(JitenCardState.MATURE);
    }

    if (candidate.stateTags.includes(JitenCardState.YOUNG)) {
      maturityStates.add(JitenCardState.YOUNG);
    }
  }

  const stateTags: JitenCardState[] = [];

  if (hasDueCandidate) {
    stateTags.push(JitenCardState.DUE);
  }

  if (hasSuspendedCandidate) {
    stateTags.push(JitenCardState.SUSPENDED);
  } else if (hasBuriedCandidate) {
    stateTags.push(JitenCardState.BURIED);
  }

  if (maturityStates.size === 1) {
    const [maturityState] = Array.from(maturityStates);

    stateTags.push(maturityState);
  }

  return stateTags;
}
