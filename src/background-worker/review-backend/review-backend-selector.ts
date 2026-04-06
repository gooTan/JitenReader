import { getConfiguration } from '@shared/configuration/get-configuration';
import {
  ReviewBackendAvailability,
  ReviewBackendAvailabilityProbes,
  ReviewBackendId,
  ReviewBackendRegistry,
  ReviewBackendStatus,
} from './review-backend-selector.types';
import { ReviewBackend } from './review-backend.types';

const DEFAULT_AVAILABILITY: Record<ReviewBackendId, ReviewBackendAvailability> = {
  jiten: 'available',
  anki: 'unknown',
};
const DEFAULT_AVAILABILITY_CACHE_TTL_MS = 30_000;

type CachedAvailabilityEntry = {
  expiresAt: number;
  value: ReviewBackendAvailability;
};

export class ReviewBackendSelector {
  private readonly _availabilityCache: Partial<Record<ReviewBackendId, CachedAvailabilityEntry>> =
    {};
  private readonly _inFlightProbes: Partial<
    Record<ReviewBackendId, Promise<ReviewBackendAvailability>>
  > = {};

  public constructor(
    private readonly _backends: ReviewBackendRegistry,
    private readonly _availabilityProbes: ReviewBackendAvailabilityProbes = {},
    private readonly _availabilityCacheTtlMs: number = DEFAULT_AVAILABILITY_CACHE_TTL_MS,
  ) {}

  public async getStatus(): Promise<ReviewBackendStatus> {
    const preferredBackend = await this.getPreferredBackend();
    const availability = await this.getAvailability(preferredBackend);
    const activeBackend = this.selectActiveBackend(preferredBackend, availability);

    return {
      preferredBackend,
      activeBackend,
      availability,
    };
  }

  public invalidateAvailabilityCache(backend?: ReviewBackendId): void {
    if (backend) {
      delete this._availabilityCache[backend];

      return;
    }

    delete this._availabilityCache.anki;
    delete this._availabilityCache.jiten;
  }

  public async getActiveBackend(): Promise<ReviewBackend> {
    const { activeBackend } = await this.getStatus();

    return this._backends[activeBackend] ?? this._backends.jiten;
  }

  public getBackend(id: ReviewBackendId): ReviewBackend | undefined {
    return this._backends[id];
  }

  private async getPreferredBackend(): Promise<ReviewBackendId> {
    const enableAnkiIntegration = await getConfiguration('enableAnkiIntegration');

    return enableAnkiIntegration ? 'anki' : 'jiten';
  }

  private async getAvailability(
    preferredBackend: ReviewBackendId,
  ): Promise<Record<ReviewBackendId, ReviewBackendAvailability>> {
    const availability: Record<ReviewBackendId, ReviewBackendAvailability> = {
      ...DEFAULT_AVAILABILITY,
    };

    if (preferredBackend === 'jiten') {
      return availability;
    }

    availability[preferredBackend] = await this.getAvailabilityFromProbe(preferredBackend);

    return availability;
  }

  private async getAvailabilityFromProbe(
    backend: ReviewBackendId,
  ): Promise<ReviewBackendAvailability> {
    const now = Date.now();
    const cachedEntry = this._availabilityCache[backend];
    const probe = this._availabilityProbes[backend];

    if (cachedEntry && cachedEntry.expiresAt > now) {
      return cachedEntry.value;
    }

    if (!probe) {
      return DEFAULT_AVAILABILITY[backend];
    }

    if (!this._inFlightProbes[backend]) {
      this._inFlightProbes[backend] = (async (): Promise<ReviewBackendAvailability> => {
        try {
          return await probe();
        } catch {
          return 'unavailable';
        }
      })();
    }

    const result = await this._inFlightProbes[backend];

    this._availabilityCache[backend] = {
      value: result,
      expiresAt: now + this._availabilityCacheTtlMs,
    };
    delete this._inFlightProbes[backend];

    return result;
  }

  private selectActiveBackend(
    preferredBackend: ReviewBackendId,
    availability: Record<ReviewBackendId, ReviewBackendAvailability>,
  ): ReviewBackendId {
    if (preferredBackend === 'anki') {
      return availability.anki === 'available' ? 'anki' : 'jiten';
    }

    return 'jiten';
  }
}
