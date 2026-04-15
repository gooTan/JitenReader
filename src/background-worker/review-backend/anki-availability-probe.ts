import { AnkiReadinessService } from './anki-readiness-service';
import { ReviewBackendAvailability } from './review-backend-selector.types';

export const createAnkiAvailabilityProbe =
  (readinessService: AnkiReadinessService): (() => Promise<ReviewBackendAvailability>) =>
  (): Promise<ReviewBackendAvailability> => {
    return readinessService.getAvailability();
  };
