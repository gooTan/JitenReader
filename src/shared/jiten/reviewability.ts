import { JitenCardState, ReviewMetadata, ReviewTargetCandidateSummary } from './types';

export type ReviewabilityReasonCode =
  | 'reviewable-selected'
  | 'reviewable-create'
  | 'blocked-config-insufficient'
  | 'blocked-none-no-create-path'
  | 'blocked-ambiguous'
  | 'blocked-suspended'
  | 'blocked-buried'
  | 'blocked-unavailable'
  | 'blocked-stale';

export type ReviewabilityMessageKey = ReviewabilityReasonCode;

export type ReviewabilityResult = {
  allowed: boolean;
  reasonCode: ReviewabilityReasonCode;
  messageKey: ReviewabilityMessageKey;
  showAddToAnkiHint: boolean;
  candidateSummary: ReviewTargetCandidateSummary[];
  recoverableByUser: boolean;
};

export type ReviewabilityCopy = {
  title: string;
  body: string;
};

export type ReviewabilityOptions = {
  createPathAvailable: boolean;
  reviewMetadata: ReviewMetadata;
};

export type BlockedReviewabilityError = {
  code: string;
  message: string;
};

const REVIEWABILITY_ERROR_CODES: Record<
  Exclude<ReviewabilityReasonCode, 'reviewable-selected' | 'reviewable-create'>,
  string
> = {
  'blocked-ambiguous': 'BLOCKED_AMBIGUOUS_TARGET',
  'blocked-buried': 'BLOCKED_BURIED_TARGET',
  'blocked-config-insufficient': 'BLOCKED_CONFIG_INSUFFICIENT',
  'blocked-none-no-create-path': 'BLOCKED_NONE_NO_CREATE_PATH',
  'blocked-stale': 'BLOCKED_STALE_TARGET',
  'blocked-suspended': 'BLOCKED_SUSPENDED_TARGET',
  'blocked-unavailable': 'BLOCKED_BACKEND_UNAVAILABLE',
};

export function ResolveReviewability(options: ReviewabilityOptions): ReviewabilityResult {
  const { createPathAvailable, reviewMetadata } = options;
  const candidateSummary = reviewMetadata.diagnostics?.candidateSummary ?? [];

  if (reviewMetadata.resolutionStatus === 'config-insufficient') {
    return createBlockedResult('blocked-config-insufficient', candidateSummary, true);
  }

  if (
    reviewMetadata.resolutionStatus === 'backend-unavailable' ||
    reviewMetadata.dueState === 'unavailable'
  ) {
    return createBlockedResult('blocked-unavailable', candidateSummary, true);
  }

  if (reviewMetadata.mappingOutcome === 'ambiguous') {
    return createBlockedResult('blocked-ambiguous', candidateSummary, false);
  }

  if (reviewMetadata.stateTags.includes(JitenCardState.SUSPENDED)) {
    return createBlockedResult('blocked-suspended', candidateSummary, true);
  }

  if (reviewMetadata.stateTags.includes(JitenCardState.BURIED)) {
    return createBlockedResult('blocked-buried', candidateSummary, true);
  }

  if (isRefreshingSelectedTarget(reviewMetadata)) {
    return createBlockedResult('blocked-stale', candidateSummary, true);
  }

  if (reviewMetadata.backend !== 'anki') {
    return {
      allowed: true,
      reasonCode: 'reviewable-selected',
      messageKey: 'reviewable-selected',
      showAddToAnkiHint: false,
      candidateSummary,
      recoverableByUser: false,
    };
  }

  if (
    reviewMetadata.resolutionStatus === 'resolved' &&
    reviewMetadata.mappingOutcome === 'selected' &&
    reviewMetadata.target?.ankiCardId
  ) {
    return {
      allowed: true,
      reasonCode: 'reviewable-selected',
      messageKey: 'reviewable-selected',
      showAddToAnkiHint: false,
      candidateSummary,
      recoverableByUser: false,
    };
  }

  if (reviewMetadata.resolutionStatus === 'resolved' && reviewMetadata.mappingOutcome === 'none') {
    if (createPathAvailable) {
      return {
        allowed: true,
        reasonCode: 'reviewable-create',
        messageKey: 'reviewable-create',
        showAddToAnkiHint: true,
        candidateSummary,
        recoverableByUser: false,
      };
    }

    return createBlockedResult('blocked-none-no-create-path', candidateSummary, true);
  }

  return createBlockedResult('blocked-none-no-create-path', candidateSummary, true);
}

export function GetReviewabilityCopy(reviewability: ReviewabilityResult): ReviewabilityCopy {
  switch (reviewability.messageKey) {
    case 'reviewable-create':
      return {
        title: 'This term is not in Anki yet.',
        body: 'Reviewing it will add the term to Anki first.',
      };
    case 'blocked-config-insufficient':
      return {
        title: 'Cannot review in Anki.',
        body: 'The Anki configuration for this term is incomplete.',
      };
    case 'blocked-none-no-create-path':
      return {
        title: 'No matching Anki target found.',
        body: 'No valid Anki write target is configured for this term yet.',
      };
    case 'blocked-ambiguous':
      return {
        title: 'Cannot review in Anki.',
        body: 'Multiple Anki targets match this term.',
      };
    case 'blocked-suspended':
      return {
        title: 'Cannot review in Anki.',
        body: 'This Anki card is suspended. Unsuspend it in Anki first.',
      };
    case 'blocked-buried':
      return {
        title: 'Cannot review in Anki.',
        body: 'This Anki card is buried. Unbury it in Anki first.',
      };
    case 'blocked-unavailable':
      return {
        title: 'Cannot review in Anki.',
        body: 'Anki is not reachable right now.',
      };
    case 'blocked-stale':
      return {
        title: 'Cannot review in Anki yet.',
        body: 'This term is still refreshing from Anki. Try again in a moment.',
      };
    case 'reviewable-selected':
    default:
      return {
        title: 'Ready to review in Anki.',
        body: '',
      };
  }
}

export function GetBlockedReviewabilityError(
  reviewability: ReviewabilityResult,
): BlockedReviewabilityError | undefined {
  if (reviewability.allowed) {
    return;
  }

  const copy = GetReviewabilityCopy(reviewability);
  const reasonCode = reviewability.reasonCode as Exclude<
    ReviewabilityReasonCode,
    'reviewable-selected' | 'reviewable-create'
  >;

  return {
    code: REVIEWABILITY_ERROR_CODES[reasonCode],
    message: [copy.title, copy.body].filter(Boolean).join(' '),
  };
}

function createBlockedResult(
  reasonCode: Exclude<ReviewabilityReasonCode, 'reviewable-selected' | 'reviewable-create'>,
  candidateSummary: ReviewTargetCandidateSummary[],
  recoverableByUser: boolean,
): ReviewabilityResult {
  return {
    allowed: false,
    reasonCode,
    messageKey: reasonCode,
    showAddToAnkiHint: false,
    candidateSummary,
    recoverableByUser,
  };
}

function isRefreshingSelectedTarget(reviewMetadata: ReviewMetadata): boolean {
  return (
    reviewMetadata.freshness === 'stale' &&
    reviewMetadata.mappingOutcome === 'selected' &&
    reviewMetadata.dueState === 'unknown' &&
    !!reviewMetadata.target?.ankiCardId
  );
}
