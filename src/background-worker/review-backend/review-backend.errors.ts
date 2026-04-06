export class UnsupportedReviewOperationError extends Error {
  public constructor(operation: string, backend: string) {
    super(`${backend} backend does not support ${operation}.`);
    this.name = 'UnsupportedReviewOperationError';
  }
}
