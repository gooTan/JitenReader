import { debug } from '@shared/debug';
import { getParagraphs } from '../batches/get-paragraphs';
import { RegisterErrorContext, RegisterOptions } from '../batches/types';
import { Registry } from '../integration/registry';
import {
  VisibleParseDiscoverySource,
  VisibleParsePriority,
  VisibleParseSchedulerMetrics,
  VisibleParseWorkItem,
} from './visible-parse-scheduler.types';

type VisibleParseSchedulerOptions = {
  observer: IntersectionObserver;
  createRegisterOptions?: (element: Element) => RegisterOptions;
  filter?: (node: HTMLElement | Text) => boolean;
  getParagraphsFn?: typeof getParagraphs;
  collapseWhitespace?: boolean;
};

export class VisibleParseScheduler {
  private static readonly DISCOVERY_DEBOUNCE_MS = 50;
  private static readonly MAX_RETRIES = 1;

  private _destroyed = false;
  private _paused = false;
  private _drainHandle?: number;
  private _nextDiscoveryOrder = 0;
  private _items = new Map<Element, VisibleParseWorkItem>();
  private _metrics: VisibleParseSchedulerMetrics = {
    discoveredCount: 0,
    duplicateDiscoveries: 0,
    queueHighWaterMark: 0,
    invalidations: 0,
    removals: 0,
    retries: 0,
    visibleCompletions: 0,
    backgroundCompletions: 0,
  };

  constructor(
    private readonly _options: VisibleParseSchedulerOptions,
    private _observer: IntersectionObserver = _options.observer,
  ) {}

  public discover(elements: Element[], source: VisibleParseDiscoverySource): void {
    let changed = false;

    for (const element of elements) {
      if (!element.isConnected) {
        this.removeElements([element]);

        continue;
      }

      if (source === 'mutation' && this._items.has(element)) {
        changed = this.invalidateElement(element, 'mutation') || changed;

        continue;
      }

      const { item, created } = this.ensureItem(
        element,
        source === 'visibility' ? 'visible' : 'background',
      );

      if (!item) {
        continue;
      }

      changed = created || changed;

      if (source === 'visibility' && item.priority !== 'visible') {
        item.priority = 'visible';
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    this.updateQueueHighWaterMark();
    this.scheduleDrain();
    this.emitDiagnostics('discover', {
      source,
    });
  }

  public demote(elements: Element[]): void {
    let changed = false;

    for (const element of elements) {
      const item = this._items.get(element);

      if (!item || item.state === 'parsed' || item.state === 'removed') {
        continue;
      }

      if (item.priority !== 'background') {
        item.priority = 'background';
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    this.scheduleDrain();
    this.emitDiagnostics('demote');
  }

  public removeElements(elements: Element[]): void {
    let changed = false;

    for (const element of elements) {
      const item = this._items.get(element);

      if (!item) {
        continue;
      }

      Registry.batchController.dismissNode(element);
      Registry.sentenceManager.dismissContainer(element as HTMLElement);
      this._observer.unobserve(element);

      item.state = 'removed';
      this._items.delete(element);
      this._metrics.removals++;
      changed = true;
    }

    if (!changed) {
      return;
    }

    this.scheduleDrain(0);
    this.emitDiagnostics('remove');
  }

  public pause(): void {
    this._paused = true;
    this.cancelScheduledDrain();
  }

  public resume(observer?: IntersectionObserver): void {
    if (observer) {
      this._observer = observer;
    }

    this._paused = false;
    this.scheduleDrain();
  }

  public setObserver(observer: IntersectionObserver): void {
    this._observer = observer;
  }

  public destroy(): void {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;
    this.cancelScheduledDrain();

    for (const element of this._items.keys()) {
      Registry.batchController.dismissNode(element);
      Registry.sentenceManager.dismissContainer(element as HTMLElement);
      this._observer.unobserve(element);
    }

    this._items.clear();
  }

  private ensureItem(
    element: Element,
    priority: VisibleParsePriority,
  ): {
    item?: VisibleParseWorkItem;
    created: boolean;
  } {
    const existing = this._items.get(element);

    if (existing) {
      if (existing.state === 'removed') {
        this._items.delete(element);
      } else {
        this._metrics.duplicateDiscoveries++;

        if (existing.state !== 'parsed' && priority === 'visible') {
          existing.priority = 'visible';
        }

        return {
          item: existing,
          created: false,
        };
      }
    }

    const item: VisibleParseWorkItem = {
      element,
      state: 'discovered',
      priority,
      discoveryOrder: ++this._nextDiscoveryOrder,
      generation: 0,
      retryCount: 0,
      retryBlocked: false,
    };

    this._items.set(element, item);
    this._metrics.discoveredCount++;

    return {
      item,
      created: true,
    };
  }

  private invalidateElement(element: Element, reason: 'mutation' | 'retry'): boolean {
    const item = this._items.get(element);

    if (!item || item.state === 'removed') {
      return false;
    }

    Registry.batchController.dismissNode(element);
    Registry.sentenceManager.dismissContainer(element as HTMLElement);

    item.state = 'invalidated';
    item.generation++;
    item.retryCount = 0;
    item.retryBlocked = false;
    item.discoveryOrder = ++this._nextDiscoveryOrder;
    this._metrics.invalidations++;

    if (!element.isConnected) {
      item.state = 'removed';
      this._items.delete(element);

      return true;
    }

    item.state = 'discovered';
    this.updateQueueHighWaterMark();
    this.scheduleDrain();
    this.emitDiagnostics('invalidate', {
      reason,
    });

    return true;
  }

  private scheduleDrain(delayMs = VisibleParseScheduler.DISCOVERY_DEBOUNCE_MS): void {
    if (
      this._destroyed ||
      this._paused ||
      this._drainHandle !== undefined ||
      this.hasInFlightWork()
    ) {
      return;
    }

    this._drainHandle = window.setTimeout(() => {
      this._drainHandle = undefined;
      this.drain();
    }, delayMs);
  }

  private cancelScheduledDrain(): void {
    if (this._drainHandle === undefined) {
      return;
    }

    clearTimeout(this._drainHandle);
    this._drainHandle = undefined;
  }

  private drain(): void {
    if (this._destroyed || this._paused || this.hasInFlightWork()) {
      return;
    }

    const candidates = Array.from(this._items.values())
      .filter((item) => this.isDispatchable(item))
      .sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority === 'visible' ? -1 : 1;
        }

        return left.discoveryOrder - right.discoveryOrder;
      });

    if (!candidates.length) {
      return;
    }

    const hasVisible = candidates.some((item) => item.priority === 'visible');
    const selected = hasVisible
      ? candidates.filter((item) => item.priority === 'visible')
      : [candidates[0]];

    for (const item of selected) {
      this.dispatchItem(item);
    }

    Registry.batchController.parseBatches();
    this.emitDiagnostics('drain', {
      dispatched: selected.length,
      priority: hasVisible ? 'visible' : 'background',
    });
  }

  private dispatchItem(item: VisibleParseWorkItem): void {
    item.state = 'queued';
    item.dispatchedPriority = item.priority;

    const generation = item.generation;
    const registerOptions = this._options.createRegisterOptions?.(item.element) ?? {
      filter: this._options.filter,
      getParagraphsFn: this._options.getParagraphsFn,
      collapseWhitespace: this._options.collapseWhitespace,
    };
    const { onComplete, onEmpty, onError, ...rest } = registerOptions;

    Registry.batchController.registerNode(item.element, {
      ...rest,
      onComplete: (node) => {
        onComplete?.(node);
        this.handleSuccess(node, generation);
      },
      onEmpty: (node) => {
        onEmpty?.(node);
        this.handleSuccess(node, generation);
      },
      onError: (node, error, context) => {
        onError?.(node, error, context);
        this.handleError(node, generation, error, context);
      },
    });

    if (item.state === 'queued') {
      item.state = 'parsing';
    }
  }

  private handleSuccess(node: Element | Node, generation: number): void {
    if (!(node instanceof Element)) {
      return;
    }

    const item = this._items.get(node);

    if (!item || item.state === 'removed' || item.generation !== generation) {
      return;
    }

    item.state = 'parsed';
    item.retryCount = 0;
    item.retryBlocked = false;

    if (item.dispatchedPriority === 'visible') {
      this._metrics.visibleCompletions++;
    } else {
      this._metrics.backgroundCompletions++;
    }

    this._observer.unobserve(node);
    item.dispatchedPriority = undefined;

    this.emitDiagnostics('complete', {
      priority: item.priority,
    });
    this.scheduleDrain(0);
  }

  private handleError(
    node: Element | Node,
    generation: number,
    error: Error,
    context: RegisterErrorContext,
  ): void {
    if (!(node instanceof Element)) {
      return;
    }

    const item = this._items.get(node);

    if (!item || item.state === 'removed' || item.generation !== generation) {
      return;
    }

    item.dispatchedPriority = undefined;

    if (context.appliedParagraphCount > 0) {
      item.retryBlocked = true;
      item.state = 'discovered';
      this.emitDiagnostics('partial-error', {
        appliedParagraphCount: context.appliedParagraphCount,
        message: error.message,
        totalParagraphCount: context.totalParagraphCount,
      });

      return;
    }

    if (item.retryCount < VisibleParseScheduler.MAX_RETRIES) {
      item.retryCount++;
      item.retryBlocked = false;
      item.state = 'discovered';
      item.discoveryOrder = ++this._nextDiscoveryOrder;
      this._metrics.retries++;
      this.updateQueueHighWaterMark();
      this.scheduleDrain(150);
      this.emitDiagnostics('retry', {
        retryCount: item.retryCount,
        message: error.message,
      });

      return;
    }

    item.retryBlocked = true;
    item.state = 'discovered';
    this.emitDiagnostics('error', {
      message: error.message,
    });
    this.scheduleDrain(0);
  }

  private isDispatchable(item: VisibleParseWorkItem): boolean {
    if (item.state !== 'discovered' || item.retryBlocked) {
      return false;
    }

    if (!item.element.isConnected) {
      item.state = 'removed';
      this._items.delete(item.element);

      return false;
    }

    return true;
  }

  private hasInFlightWork(): boolean {
    return Array.from(this._items.values()).some(
      (item) => item.state === 'queued' || item.state === 'parsing',
    );
  }

  private updateQueueHighWaterMark(): void {
    const active = Array.from(this._items.values()).filter(
      (item) => item.state !== 'parsed' && item.state !== 'removed',
    ).length;

    this._metrics.queueHighWaterMark = Math.max(this._metrics.queueHighWaterMark, active);
  }

  private emitDiagnostics(event: string, extra: Record<string, unknown> = {}): void {
    debug('ParseVisibleScheduler', {
      event,
      discovered: this._metrics.discoveredCount,
      duplicates: this._metrics.duplicateDiscoveries,
      inFlight: Array.from(this._items.values()).filter(
        (item) => item.state === 'queued' || item.state === 'parsing',
      ).length,
      invalidations: this._metrics.invalidations,
      queued: Array.from(this._items.values()).filter((item) => item.state === 'discovered').length,
      queueHighWaterMark: this._metrics.queueHighWaterMark,
      removals: this._metrics.removals,
      retries: this._metrics.retries,
      visibleCompletions: this._metrics.visibleCompletions,
      backgroundCompletions: this._metrics.backgroundCompletions,
      ...extra,
    });
  }
}
