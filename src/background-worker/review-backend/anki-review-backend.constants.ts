import { ReviewBackendCapabilities } from './review-backend.types';

export const ANKI_REVIEW_BACKEND_CAPABILITIES: ReviewBackendCapabilities = {
  supportsDeckActions: false,
  supportsSentenceAttach: false,
};

export const READ_PROBE_CACHE_TTL_MS = 30_000;
export const LOOKUP_CACHE_TTL_MS = 15_000;
export const MAX_BATCH_IDS = 300;
export const FIND_NOTES_MULTI_BATCH_SIZE = 50;
export const FIND_NOTES_CONCURRENCY_LIMIT = 6;
export const NOTES_INFO_CONCURRENCY_LIMIT = 4;
export const CARDS_INFO_CONCURRENCY_LIMIT = 4;
export const ANKI_QUEUE_LEARNING = 1;
export const ANKI_QUEUE_REVIEW = 2;
export const ANKI_QUEUE_RELEARNING = 3;
export const ANKI_QUEUE_PREVIEW = 4;
export const ANKI_QUEUE_NEW = 0;
export const ANKI_QUEUE_SUSPENDED = -1;
export const ANKI_QUEUE_SIBLING_BURIED = -2;
export const ANKI_QUEUE_MANUALLY_BURIED = -3;
export const ANKI_FALLBACK_ROLLOVER_HOUR = 4;
export const ANKI_MATURE_INTERVAL_DAYS = 21;
export const ROLLOVER_CACHE_TTL_MS = 30_000;
export const COLLECTION_CREATION_CACHE_TTL_MS = 300_000;
