import { JitenReviewBackend } from '@shared/jiten/types';

export type GradeCardCommandResult =
  | {
      success: true;
      backend: JitenReviewBackend;
    }
  | {
      success: false;
      backend: 'anki';
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };
