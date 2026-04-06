import { ReviewBackend } from './review-backend.types';

export type ReviewBackendId = 'jiten' | 'anki';

export type ReviewBackendAvailability = 'available' | 'unavailable' | 'unknown';

export type ReviewBackendStatus = {
  preferredBackend: ReviewBackendId;
  activeBackend: ReviewBackendId;
  availability: Record<ReviewBackendId, ReviewBackendAvailability>;
};

export type ReviewBackendRegistry = {
  jiten: ReviewBackend;
  anki?: ReviewBackend;
};

export type ReviewBackendAvailabilityProbes = Partial<
  Record<ReviewBackendId, () => Promise<ReviewBackendAvailability>>
>;
