import { findNotes } from '@shared/anki/find-notes';
import { getApiVersion } from '@shared/anki/get-api-version';
import { JitenCardState, JitenRawVocabulary, JitenRating } from '@shared/jiten/types';
import { UnsupportedReviewOperationError } from './review-backend.errors';
import {
  ReviewBackend,
  ReviewBackendCapabilities,
  ReviewDeck,
  ReviewDeckAction,
  ReviewTermStateMap,
} from './review-backend.types';

const ANKI_REVIEW_BACKEND_CAPABILITIES: ReviewBackendCapabilities = {
  supportsDeckActions: false,
  supportsSentenceAttach: false,
};
const READ_PROBE_CACHE_TTL_MS = 30_000;

export class AnkiReviewBackend implements ReviewBackend {
  private _cachedReadProbeExpiresAt = 0;
  private _inFlightReadProbe?: Promise<void>;

  public getCapabilities(): ReviewBackendCapabilities {
    return ANKI_REVIEW_BACKEND_CAPABILITIES;
  }

  public async getParseReviewStates(
    _vocabulary: JitenRawVocabulary[],
  ): Promise<ReviewTermStateMap> {
    await this.ensureReadOnlyPathReady();

    return {};
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
}
