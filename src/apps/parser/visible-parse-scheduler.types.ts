export type VisibleParseState =
  | 'discovered'
  | 'queued'
  | 'parsing'
  | 'parsed'
  | 'invalidated'
  | 'removed';

export type VisibleParsePriority = 'visible' | 'background';

export type VisibleParseDiscoverySource = 'initial' | 'visibility' | 'mutation';

export type VisibleParseWorkItem = {
  element: Element;
  state: VisibleParseState;
  priority: VisibleParsePriority;
  discoveryOrder: number;
  generation: number;
  retryCount: number;
  retryBlocked: boolean;
  dispatchedPriority?: VisibleParsePriority;
};

export type VisibleParseSchedulerMetrics = {
  discoveredCount: number;
  duplicateDiscoveries: number;
  queueHighWaterMark: number;
  invalidations: number;
  removals: number;
  retries: number;
  visibleCompletions: number;
  backgroundCompletions: number;
};
