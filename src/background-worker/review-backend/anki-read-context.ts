import { AnkiCardInfo } from '@shared/anki/api.types';
import { findNotes } from '@shared/anki/find-notes';
import { getApiVersion } from '@shared/anki/get-api-version';
import { getCollectionCreationTime } from '@shared/anki/get-collection-creation-time';
import { getConfiguration } from '@shared/configuration/get-configuration';
import {
  ANKI_FALLBACK_ROLLOVER_HOUR,
  ANKI_QUEUE_LEARNING,
  ANKI_QUEUE_PREVIEW,
  ANKI_QUEUE_RELEARNING,
  ANKI_QUEUE_REVIEW,
  COLLECTION_CREATION_CACHE_TTL_MS,
  READ_PROBE_CACHE_TTL_MS,
  ROLLOVER_CACHE_TTL_MS,
} from './anki-review-backend.constants';

export class AnkiReadContext {
  private _cachedCollectionCreatedAtExpiresAt = 0;
  private _cachedCollectionCreatedAtMs?: number;
  private _cachedReadProbeExpiresAt = 0;
  private _cachedRolloverHourExpiresAt = 0;
  private _cachedRolloverHour = ANKI_FALLBACK_ROLLOVER_HOUR;
  private _inFlightCollectionCreatedAtProbe?: Promise<number | undefined>;
  private _inFlightReadProbe?: Promise<void>;
  private _inFlightRolloverProbe?: Promise<number>;

  public invalidate(): void {
    this._cachedReadProbeExpiresAt = 0;
    this._cachedRolloverHourExpiresAt = 0;
    this._cachedCollectionCreatedAtExpiresAt = 0;
    this._cachedCollectionCreatedAtMs = undefined;
    this._inFlightReadProbe = undefined;
    this._inFlightRolloverProbe = undefined;
    this._inFlightCollectionCreatedAtProbe = undefined;
  }

  public async ensureReady(): Promise<void> {
    await this.ensureReadOnlyPathReady();
    await this.ensureRolloverHourLoaded();
    await this.ensureCollectionCreatedAtLoaded();
  }

  public isCardDue(card: Pick<AnkiCardInfo, 'queue' | 'due'>): boolean {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ankiCollectionDayNumber = this.getAnkiCurrentCollectionDayNumber();

    if (card.queue === ANKI_QUEUE_REVIEW || card.queue === ANKI_QUEUE_RELEARNING) {
      if (ankiCollectionDayNumber === undefined) {
        throw new Error('Anki scheduling context is unavailable (missing collection day).');
      }

      return card.due <= ankiCollectionDayNumber;
    }

    if (card.queue === ANKI_QUEUE_LEARNING || card.queue === ANKI_QUEUE_PREVIEW) {
      return card.due <= nowSeconds;
    }

    return false;
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

  private async ensureRolloverHourLoaded(): Promise<void> {
    const now = Date.now();

    if (this._cachedRolloverHourExpiresAt > now) {
      return;
    }

    if (!this._inFlightRolloverProbe) {
      this._inFlightRolloverProbe = (async (): Promise<number> => {
        const configuredRolloverHour = await getConfiguration('ankiRolloverHour');

        if (
          typeof configuredRolloverHour !== 'number' ||
          !Number.isFinite(configuredRolloverHour)
        ) {
          return ANKI_FALLBACK_ROLLOVER_HOUR;
        }

        return Math.min(23, Math.max(0, Math.floor(configuredRolloverHour)));
      })();
    }

    try {
      this._cachedRolloverHour = await this._inFlightRolloverProbe;
      this._cachedRolloverHourExpiresAt = now + ROLLOVER_CACHE_TTL_MS;
    } finally {
      this._inFlightRolloverProbe = undefined;
    }
  }

  private async ensureCollectionCreatedAtLoaded(): Promise<void> {
    const now = Date.now();

    if (this._cachedCollectionCreatedAtExpiresAt > now) {
      return;
    }

    if (!this._inFlightCollectionCreatedAtProbe) {
      this._inFlightCollectionCreatedAtProbe = (async (): Promise<number | undefined> => {
        const rawCreationTime = await getCollectionCreationTime({
          showToastOnError: false,
        });

        return this.normaliseCollectionCreationTime(rawCreationTime);
      })();
    }

    try {
      const resolvedCreationTime = await this._inFlightCollectionCreatedAtProbe;

      if (resolvedCreationTime === undefined) {
        throw new Error(
          'Anki scheduling context is unavailable (invalid collection creation time).',
        );
      }

      this._cachedCollectionCreatedAtMs = resolvedCreationTime;
      this._cachedCollectionCreatedAtExpiresAt = now + COLLECTION_CREATION_CACHE_TTL_MS;
    } finally {
      this._inFlightCollectionCreatedAtProbe = undefined;
    }
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

  private getAnkiCurrentCollectionDayNumber(): number | undefined {
    if (this._cachedCollectionCreatedAtMs === undefined) {
      return;
    }

    const nowAnchor = this.getAnkiDayAnchor(new Date());
    const collectionAnchor = this.getAnkiDayAnchor(new Date(this._cachedCollectionCreatedAtMs));
    const nowEpochDay = this.getEpochDayNumber(nowAnchor);
    const collectionEpochDay = this.getEpochDayNumber(collectionAnchor);

    return Math.max(0, nowEpochDay - collectionEpochDay);
  }

  private getAnkiDayAnchor(date: Date): Date {
    const ankiDayAnchor = new Date(date);

    if (date.getHours() < this._cachedRolloverHour) {
      ankiDayAnchor.setDate(ankiDayAnchor.getDate() - 1);
    }

    ankiDayAnchor.setHours(0, 0, 0, 0);

    return ankiDayAnchor;
  }

  private getEpochDayNumber(anchor: Date): number {
    return Math.floor(
      Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()) / 86_400_000,
    );
  }
}
