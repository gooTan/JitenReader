import { cardsInfo } from '@shared/anki/cards-info';
import { findNotes } from '@shared/anki/find-notes';
import { getApiVersion } from '@shared/anki/get-api-version';
import { notesInfo } from '@shared/anki/notes-info';
import { DiscoverWordConfiguration } from '@shared/anki/types';
import { getConfiguration } from '@shared/configuration/get-configuration';
import {
  JitenCardState,
  JitenRawVocabulary,
  JitenRating,
  ReviewTargetMetadata,
} from '@shared/jiten/types';
import { UnsupportedReviewOperationError } from './review-backend.errors';
import {
  ReviewBackend,
  ReviewBackendCapabilities,
  ReviewDeck,
  ReviewDeckAction,
  ReviewTermResolution,
  ReviewTermResolutionMap,
} from './review-backend.types';

const ANKI_REVIEW_BACKEND_CAPABILITIES: ReviewBackendCapabilities = {
  supportsDeckActions: false,
  supportsSentenceAttach: false,
};
const READ_PROBE_CACHE_TTL_MS = 30_000;
const MAX_BATCH_IDS = 300;
const ANKI_QUEUE_DUE_LEARNING = 1;
const ANKI_QUEUE_DUE_REVIEW = 2;
const ANKI_QUEUE_DUE_RELEARNING = 3;
const ELIGIBLE_TEMPLATE_ORDS = new Set<number>([0]);

type AnkiTargetCandidate = {
  target: ReviewTargetMetadata;
  stateTags: JitenCardState[];
  dueState: 'due' | 'notDue';
};

type EligibleAnkiTargets = {
  decks: Set<string>;
  models: Set<string>;
  templates: Set<number>;
};

export class AnkiReviewBackend implements ReviewBackend {
  private _cachedReadProbeExpiresAt = 0;
  private _inFlightReadProbe?: Promise<void>;

  public getCapabilities(): ReviewBackendCapabilities {
    return ANKI_REVIEW_BACKEND_CAPABILITIES;
  }

  public async getParseReviewStates(
    vocabulary: JitenRawVocabulary[],
  ): Promise<ReviewTermResolutionMap> {
    await this.ensureReadOnlyPathReady();

    const readonlyConfigs = await getConfiguration('ankiReadonlyConfigs');
    const eligibleTargets = await this.getEligibleAnkiTargets(readonlyConfigs);
    const statesByTermKey = new Map<string, ReviewTermResolution>();

    for (const vocab of vocabulary) {
      const termKey = this.getTermKey(vocab);

      if (statesByTermKey.has(termKey)) {
        continue;
      }

      const result = await this.resolveTerm(vocab, readonlyConfigs, eligibleTargets);

      statesByTermKey.set(termKey, result);
    }

    const states: ReviewTermResolutionMap = {};

    for (const vocab of vocabulary) {
      const key = `${vocab.wordId}/${vocab.readingIndex}`;
      const termKey = this.getTermKey(vocab);
      const result = statesByTermKey.get(termKey);

      states[key] = result ?? this.createUnmappedResolution();
    }

    return states;
  }

  public async getCardState(_wordId: number, _readingIndex: number): Promise<JitenCardState[]> {
    await this.ensureReadOnlyPathReady();

    return [];
  }

  public gradeCard(_wordId: number, _readingIndex: number, _rating: JitenRating): Promise<void> {
    throw new UnsupportedReviewOperationError('gradeCard', 'anki');
  }

  public forgetCard(_wordId: number, _readingIndex: number): Promise<void> {
    throw new UnsupportedReviewOperationError('forgetCard', 'anki');
  }

  public runDeckAction(
    _wordId: number,
    _readingIndex: number,
    _deck: ReviewDeck,
    _action: ReviewDeckAction,
    _sentence?: string,
  ): Promise<void> {
    throw new UnsupportedReviewOperationError('runDeckAction', 'anki');
  }

  private async ensureReadOnlyPathReady(): Promise<void> {
    const now = Date.now();

    if (this._cachedReadProbeExpiresAt > now) {
      return;
    }

    if (!this._inFlightReadProbe) {
      this._inFlightReadProbe = (async (): Promise<void> => {
        await getApiVersion({ showToastOnError: false });
        await findNotes('nid:0', { showToastOnError: false });
        this._cachedReadProbeExpiresAt = Date.now() + READ_PROBE_CACHE_TTL_MS;
      })();
    }

    try {
      await this._inFlightReadProbe;
    } finally {
      this._inFlightReadProbe = undefined;
    }
  }

  private async resolveTerm(
    vocab: JitenRawVocabulary,
    readonlyConfigs: DiscoverWordConfiguration[],
    eligibleTargets: EligibleAnkiTargets,
  ): Promise<ReviewTermResolution> {
    if (readonlyConfigs.length === 0) {
      return this.createUnavailableResolution();
    }

    if (eligibleTargets.models.size === 0 || eligibleTargets.decks.size === 0) {
      return this.createUnavailableResolution();
    }

    const candidates: AnkiTargetCandidate[] = [];
    const seenTargets = new Set<string>();

    for (const config of readonlyConfigs) {
      const noteIds = await this.findMatchingNotes(vocab, config);

      if (noteIds.length === 0) {
        continue;
      }

      const info = await this.getCandidatesFromNotes(vocab, config, noteIds, eligibleTargets);

      for (const candidate of info) {
        if (seenTargets.has(candidate.target.key)) {
          continue;
        }

        candidates.push(candidate);
        seenTargets.add(candidate.target.key);
      }
    }

    if (candidates.length === 0) {
      return this.createUnmappedResolution();
    }

    if (candidates.length > 1) {
      const hasDueCandidate = candidates.some((candidate) => candidate.dueState === 'due');

      return {
        stateTags: hasDueCandidate ? [JitenCardState.DUE] : [JitenCardState.YOUNG],
        mappingState: 'ambiguous',
        dueState: hasDueCandidate ? 'due' : 'notDue',
        targetState: 'ambiguous',
      };
    }

    const [candidate] = candidates;

    return {
      stateTags: candidate.stateTags,
      mappingState: 'mapped',
      dueState: candidate.dueState,
      targetState: 'selected',
      target: candidate.target,
    };
  }

  private findMatchingNotes(
    vocab: JitenRawVocabulary,
    config: DiscoverWordConfiguration,
  ): Promise<number[]> {
    const model = config.model?.trim();
    const wordField = config.wordField?.trim();

    if (!model?.length || !wordField?.length) {
      return [];
    }

    const queryParts = [
      this.createAnkiQuerySegment('note', model),
      this.createAnkiQuerySegment(wordField, vocab.spelling),
    ];

    if (config.deck?.trim().length) {
      queryParts.push(this.createAnkiQuerySegment('deck', config.deck.trim()));
    }

    const query = queryParts.join(' ');

    return findNotes(query, { showToastOnError: false });
  }

  private async getCandidatesFromNotes(
    vocab: JitenRawVocabulary,
    config: DiscoverWordConfiguration,
    noteIds: number[],
    eligibleTargets: EligibleAnkiTargets,
  ): Promise<AnkiTargetCandidate[]> {
    const notes = await this.readNotesInChunks(noteIds);
    const eligibleNotes = notes.filter((note) => {
      if (!eligibleTargets.models.has(note.modelName)) {
        return false;
      }

      const wordValue = this.normaliseTextValue(note.fields[config.wordField]?.value ?? '');

      if (wordValue !== this.normaliseTextValue(vocab.spelling)) {
        return false;
      }

      if (!config.readingField?.trim().length) {
        return true;
      }

      const noteReading = this.normaliseReadingValue(note.fields[config.readingField]?.value ?? '');
      const vocabReading = this.normaliseReadingValue(vocab.reading);

      return noteReading === vocabReading;
    });

    const cardIds = eligibleNotes.flatMap((note) => note.cards);

    if (cardIds.length === 0) {
      return [];
    }

    const cards = await this.readCardsInChunks(cardIds);
    const candidates: AnkiTargetCandidate[] = [];

    for (const card of cards) {
      if (!eligibleTargets.decks.has(card.deckName)) {
        continue;
      }

      if (!eligibleTargets.models.has(card.modelName)) {
        continue;
      }

      if (!eligibleTargets.templates.has(card.ord)) {
        continue;
      }

      const due = this.isCardDue(card.queue);

      candidates.push({
        target: {
          key: `anki:${card.cardId}`,
          wordId: vocab.wordId,
          readingIndex: vocab.readingIndex,
          ankiNoteId: card.note,
          ankiCardId: card.cardId,
          ankiDeck: card.deckName,
          ankiModel: card.modelName,
          ankiTemplateOrd: card.ord,
        },
        stateTags: due ? [JitenCardState.DUE, JitenCardState.YOUNG] : [JitenCardState.YOUNG],
        dueState: due ? 'due' : 'notDue',
      });
    }

    return candidates;
  }

  private async getEligibleAnkiTargets(
    readonlyConfigs: DiscoverWordConfiguration[],
  ): Promise<EligibleAnkiTargets> {
    const mining = await getConfiguration('ankiMiningConfig');
    const blacklist = await getConfiguration('ankiBlacklistConfig');
    const neverForget = await getConfiguration('ankiNeverForgetConfig');
    const decks = new Set<string>();
    const models = new Set<string>();

    for (const config of readonlyConfigs) {
      if (config.deck?.trim().length) {
        decks.add(config.deck.trim());
      }

      if (config.model?.trim().length) {
        models.add(config.model.trim());
      }
    }

    for (const config of [mining, blacklist, neverForget]) {
      if (config.deck?.trim().length) {
        decks.add(config.deck.trim());
      }

      if (config.model?.trim().length) {
        models.add(config.model.trim());
      }
    }

    return {
      decks,
      models,
      templates: new Set(ELIGIBLE_TEMPLATE_ORDS),
    };
  }

  private async readNotesInChunks(noteIds: number[]): ReturnType<typeof notesInfo> {
    const chunks = this.chunkIds(noteIds);
    const merged = [];

    for (const chunk of chunks) {
      const chunkResult = await notesInfo(chunk, { showToastOnError: false });

      merged.push(...chunkResult);
    }

    return merged;
  }

  private async readCardsInChunks(cardIds: number[]): ReturnType<typeof cardsInfo> {
    const chunks = this.chunkIds(cardIds);
    const merged = [];

    for (const chunk of chunks) {
      const chunkResult = await cardsInfo(chunk, { showToastOnError: false });

      merged.push(...chunkResult);
    }

    return merged;
  }

  private createAnkiQuerySegment(field: string, value: string): string {
    const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

    return `${field}:"${escaped}"`;
  }

  private getTermKey(vocab: JitenRawVocabulary): string {
    const spelling = this.normaliseTextValue(vocab.spelling);
    const reading = this.normaliseReadingValue(vocab.reading);

    return `${spelling}\u0000${reading}`;
  }

  private normaliseTextValue(value: string): string {
    return value.normalize('NFKC').replace(/\s+/g, '').trim();
  }

  private normaliseReadingValue(value: string): string {
    const flattened = value
      .replace(/[\u4e00-\u9faf\u3005-\u3007]+\[([^\]]+)\]/g, '$1')
      .replace(/[\[\]]/g, '');

    return this.katakanaToHiragana(this.normaliseTextValue(flattened));
  }

  private katakanaToHiragana(value: string): string {
    return value.replace(/[\u30a1-\u30f6]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0x60),
    );
  }

  private isCardDue(queue: number): boolean {
    return (
      queue === ANKI_QUEUE_DUE_LEARNING ||
      queue === ANKI_QUEUE_DUE_REVIEW ||
      queue === ANKI_QUEUE_DUE_RELEARNING
    );
  }

  private chunkIds(ids: number[]): number[][] {
    const chunks = [];

    for (let i = 0; i < ids.length; i += MAX_BATCH_IDS) {
      chunks.push(ids.slice(i, i + MAX_BATCH_IDS));
    }

    return chunks;
  }

  private createUnavailableResolution(): ReviewTermResolution {
    return {
      stateTags: [],
      mappingState: 'unmapped',
      dueState: 'unavailable',
      targetState: 'none',
    };
  }

  private createUnmappedResolution(): ReviewTermResolution {
    return {
      stateTags: [],
      mappingState: 'unmapped',
      dueState: 'unknown',
      targetState: 'none',
    };
  }
}
