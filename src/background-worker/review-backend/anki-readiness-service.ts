import { findNotes } from '@shared/anki/find-notes';
import { getApiVersion } from '@shared/anki/get-api-version';
import { getCollectionCreationTime } from '@shared/anki/get-collection-creation-time';
import { getConfiguration } from '@shared/configuration/get-configuration';
import { READ_PROBE_CACHE_TTL_MS } from './anki-review-backend.constants';
import { ReviewBackendAvailability } from './review-backend-selector.types';

const MINIMUM_ANKI_CONNECT_API_VERSION = 6;

type AnkiReadinessState = {
  collectionCreatedAtMs: number;
};

export class AnkiReadinessService {
  private _cachedReadyState?: AnkiReadinessState;
  private _cachedReadyStateExpiresAt = 0;
  private _inFlightReadyState?: Promise<AnkiReadinessState>;

  public invalidate(): void {
    this._cachedReadyState = undefined;
    this._cachedReadyStateExpiresAt = 0;
    this._inFlightReadyState = undefined;
  }

  public async getAvailability(): Promise<ReviewBackendAvailability> {
    try {
      await this.ensureReady();

      return 'available';
    } catch {
      return 'unavailable';
    }
  }

  public async ensureReady(): Promise<AnkiReadinessState> {
    const now = Date.now();

    if (this._cachedReadyState && this._cachedReadyStateExpiresAt > now) {
      return this._cachedReadyState;
    }

    if (!this._inFlightReadyState) {
      this._inFlightReadyState = this.probeReadiness();
    }

    try {
      const readyState = await this._inFlightReadyState;

      this._cachedReadyState = readyState;
      this._cachedReadyStateExpiresAt = Date.now() + READ_PROBE_CACHE_TTL_MS;

      return readyState;
    } catch (error) {
      this.invalidate();

      throw error;
    } finally {
      this._inFlightReadyState = undefined;
    }
  }

  public getCachedCollectionCreatedAtMs(): number | undefined {
    if (!this._cachedReadyState || this._cachedReadyStateExpiresAt <= Date.now()) {
      return;
    }

    return this._cachedReadyState.collectionCreatedAtMs;
  }

  private async probeReadiness(): Promise<AnkiReadinessState> {
    const ankiUrl = await getConfiguration('ankiUrl');

    if (!ankiUrl?.length) {
      throw new Error('Anki readiness probe failed: missing AnkiConnect URL.');
    }

    const apiVersion = await getApiVersion({
      ankiConnectUrl: ankiUrl,
      showToastOnError: false,
    });

    if (apiVersion < MINIMUM_ANKI_CONNECT_API_VERSION) {
      throw new Error('Anki readiness probe failed: unsupported AnkiConnect API version.');
    }

    await findNotes('nid:0', {
      ankiConnectUrl: ankiUrl,
      showToastOnError: false,
    });

    const rawCollectionCreationTime = await getCollectionCreationTime({
      ankiConnectUrl: ankiUrl,
      showToastOnError: false,
    });
    const collectionCreatedAtMs = this.normaliseCollectionCreationTime(rawCollectionCreationTime);

    if (collectionCreatedAtMs === undefined) {
      throw new Error('Anki readiness probe failed: invalid collection creation time.');
    }

    return {
      collectionCreatedAtMs,
    };
  }

  private normaliseCollectionCreationTime(rawCreationTime: number): number | undefined {
    if (!Number.isFinite(rawCreationTime) || rawCreationTime <= 0) {
      return;
    }

    if (rawCreationTime >= 1_000_000_000_000) {
      return Math.floor(rawCreationTime);
    }

    return Math.floor(rawCreationTime * 1000);
  }
}
