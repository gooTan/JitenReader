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

export class ReviewBackendSelector {
  public constructor(
    private readonly _backends: ReviewBackendRegistry,
    private readonly _availabilityProbes: ReviewBackendAvailabilityProbes = {},
  ) {}

  public async getStatus(): Promise<ReviewBackendStatus> {
    const preferredBackend = await this.getPreferredBackend();
    const availability = await this.getAvailability();
    const activeBackend = this.selectActiveBackend(preferredBackend, availability);

    return {
      preferredBackend,
      activeBackend,
      availability,
    };
  }

  public async getActiveBackend(): Promise<ReviewBackend> {
    const { activeBackend } = await this.getStatus();

    return this._backends[activeBackend] ?? this._backends.jiten;
  }

  private async getPreferredBackend(): Promise<ReviewBackendId> {
    const enableAnkiIntegration = await getConfiguration('enableAnkiIntegration');

    return enableAnkiIntegration ? 'anki' : 'jiten';
  }

  private async getAvailability(): Promise<Record<ReviewBackendId, ReviewBackendAvailability>> {
    const availability: Record<ReviewBackendId, ReviewBackendAvailability> = {
      ...DEFAULT_AVAILABILITY,
    };

    for (const backend of Object.keys(this._availabilityProbes) as ReviewBackendId[]) {
      const probe = this._availabilityProbes[backend];

      if (!probe) {
        continue;
      }

      availability[backend] = await probe();
    }

    return availability;
  }

  private selectActiveBackend(
    preferredBackend: ReviewBackendId,
    availability: Record<ReviewBackendId, ReviewBackendAvailability>,
  ): ReviewBackendId {
    const preferredIsAvailable = availability[preferredBackend] === 'available';
    const preferredExists = Boolean(this._backends[preferredBackend]);

    if (preferredIsAvailable && preferredExists) {
      return preferredBackend;
    }

    return 'jiten';
  }
}
