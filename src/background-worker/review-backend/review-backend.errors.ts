export class UnsupportedReviewOperationError extends Error {
  public constructor(operation: string, backend: string) {
    super(`${backend} backend does not support ${operation}.`);
    this.name = 'UnsupportedReviewOperationError';
  }
}

export class TargetedReviewWriteError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TargetedReviewWriteError';
  }
}
