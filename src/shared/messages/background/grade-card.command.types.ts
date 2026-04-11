import { JitenReviewBackend, ReviewMetadata } from '@shared/jiten/types';

export type GradeCardCommandResult =
  | {
      success: true;
      backend: JitenReviewBackend;
      reviewMetadata?: ReviewMetadata;
      targetCardId?: number;
      transaction?: 'reviewed-existing' | 'created-and-reviewed';
      sentenceFieldCount?: number;
    }
  | {
      success: false;
      backend: JitenReviewBackend;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };
