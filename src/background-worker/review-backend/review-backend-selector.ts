import { getConfiguration } from '@shared/configuration/get-configuration';
import { debug } from '@shared/debug';
import {
  ReviewBackendAvailability,
  ReviewBackendAvailabilityProbes,
  ReviewBackendSelectionOptions,
  ReviewBackendSelectionSnapshot,
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

type AvailabilityProbeResult = {
  availability: ReviewBackendAvailability;
  cacheHit: boolean;
  probeMs: number;
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

  public async getStatus(options?: ReviewBackendSelectionOptions): Promise<ReviewBackendStatus> {
    const preferredBackendStartedAt = performance.now();
    const preferredBackend = await this.getPreferredBackend(options);
    const preferredBackendMs = performance.now() - preferredBackendStartedAt;
    const availabilityStartedAt = performance.now();
    const availabilityResult = await this.getAvailability(preferredBackend);
    const availabilityMs = performance.now() - availabilityStartedAt;
    const availability = availabilityResult.availability;
    const activeBackend = this.selectActiveBackend(preferredBackend, availability);

    debug('ParseBackendSelection', {
      activeBackend,
      availability,
      availabilityCacheHit: availabilityResult.cacheHit,
      availabilityMs,
      preferredBackend,
      preferredBackendMs,
      probeMs: availabilityResult.probeMs,
      requestedBackend: options?.requestedBackend ?? null,
    });

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
    const { backend } = await this.getSelectionSnapshot();

    return backend;
  }

  public async getSelectionSnapshot(
    options?: ReviewBackendSelectionOptions,
  ): Promise<ReviewBackendSelectionSnapshot> {
    const status = await this.getStatus(options);
    const backend = this._backends[status.activeBackend] ?? this._backends.jiten;

    return { status, backend };
  }

  public getBackend(id: ReviewBackendId): ReviewBackend | undefined {
    return this._backends[id];
  }

  private async getPreferredBackend(
    options?: ReviewBackendSelectionOptions,
  ): Promise<ReviewBackendId> {
    if (options?.requestedBackend) {
      return options.requestedBackend;
    }

    const enableAnkiIntegration = await getConfiguration('enableAnkiIntegration');

    return enableAnkiIntegration ? 'anki' : 'jiten';
  }

  private async getAvailability(preferredBackend: ReviewBackendId): Promise<{
    availability: Record<ReviewBackendId, ReviewBackendAvailability>;
    cacheHit: boolean;
    probeMs: number;
  }> {
    const availability: Record<ReviewBackendId, ReviewBackendAvailability> = {
      ...DEFAULT_AVAILABILITY,
    };

    if (preferredBackend === 'jiten') {
      return {
        availability,
        cacheHit: true,
        probeMs: 0,
      };
    }

    const probeResult = await this.getAvailabilityFromProbe(preferredBackend);

    availability[preferredBackend] = probeResult.availability;

    return {
      availability,
      cacheHit: probeResult.cacheHit,
      probeMs: probeResult.probeMs,
    };
  }

  private async getAvailabilityFromProbe(
    backend: ReviewBackendId,
  ): Promise<AvailabilityProbeResult> {
    const now = Date.now();
    const cachedEntry = this._availabilityCache[backend];
    const probe = this._availabilityProbes[backend];

    if (cachedEntry && cachedEntry.expiresAt > now) {
      return {
        availability: cachedEntry.value,
        cacheHit: true,
        probeMs: 0,
      };
    }

    if (!probe) {
      return {
        availability: DEFAULT_AVAILABILITY[backend],
        cacheHit: true,
        probeMs: 0,
      };
    }

    const probeStartedAt = performance.now();

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
    const probeMs = performance.now() - probeStartedAt;

    this._availabilityCache[backend] = {
      value: result,
      expiresAt: now + this._availabilityCacheTtlMs,
    };

    delete this._inFlightProbes[backend];

    return {
      availability: result,
      cacheHit: false,
      probeMs,
    };
  }

  private selectActiveBackend(
    preferredBackend: ReviewBackendId,
    _availability: Record<ReviewBackendId, ReviewBackendAvailability>,
  ): ReviewBackendId {
    if (preferredBackend === 'anki') {
      return this._backends.anki ? 'anki' : 'jiten';
    }

    return 'jiten';
  }
}
