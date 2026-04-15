import { debug } from '@shared/debug';
import { displayToast } from '@shared/dom/display-toast';
import { JitenToken } from '@shared/jiten/types';
import { ParseCommand } from '@shared/messages/background/parse.command';
import { Registry } from '../integration/registry';
import { Canceled } from '../sequence/canceled';
import { AbortableSequence } from '../sequence/types';
import { applyTokens } from './apply-tokens';
import { getParagraphs } from './get-paragraphs';
import { Paragraph, RegisterOptions } from './types';

type SequenceDiagnostics = {
  registeredAt: number;
  dispatchedAt?: number;
  characters: number;
  fragments: number;
};

export class BatchController {
  private _pendingBatches = new Map<Node, AbortableSequence<JitenToken[], Paragraph>[]>();
  private _sequenceDiagnostics = new Map<number, SequenceDiagnostics>();

  public registerNodes(nodes: (Element | Node)[], options: RegisterOptions = {}): void {
    nodes.forEach((node) => this.registerNode(node, options));
  }

  public registerNode(node: Element | Node, options: RegisterOptions = {}): void {
    const {
      filter,
      onEmpty,
      getParagraphsFn = getParagraphs,
      applyFn = applyTokens,
      collapseWhitespace,
      onComplete,
      onError,
    } = options;

    if (this._pendingBatches.has(node)) {
      return;
    }

    const paragraphReadStartedAt = performance.now();
    const paragraphs = getParagraphsFn(node, filter, collapseWhitespace);
    const paragraphReadMs = performance.now() - paragraphReadStartedAt;

    debug('ParseForeground ParagraphsPrepared', {
      nodeName: node instanceof Element ? node.tagName : node.nodeName,
      paragraphCount: paragraphs.length,
      paragraphReadMs,
      textLength: paragraphs.reduce(
        (total, paragraph) => total + paragraph.reduce((sum, fragment) => sum + fragment.length, 0),
        0,
      ),
    });

    if (!paragraphs.length) {
      return onEmpty?.(node);
    }

    this.prepareNode(node, paragraphs, applyFn, onComplete, onError);
  }

  public dismissNode(node: Node): void {
    this._pendingBatches.get(node)?.forEach((batch) => batch.abort());
    this._pendingBatches.delete(node);
  }

  public abortAll(): void {
    this._pendingBatches.forEach((batches) => batches.forEach((batch) => batch.abort()));
    this._pendingBatches.clear();
  }

  public parseBatches(afterSend?: () => void): void {
    const batches = Array.from(this._pendingBatches.values());
    const sequences = batches.flatMap((b) => b);
    const sequenceData = sequences.map(
      (s) => [s.sequenceId, s.data.map((f) => f.node.data).join('')] as [number, string],
    );
    const dispatchedAt = performance.now();

    for (const sequence of sequences) {
      const diagnostics = this._sequenceDiagnostics.get(sequence.sequenceId);

      if (!diagnostics) {
        continue;
      }

      diagnostics.dispatchedAt = dispatchedAt;
    }

    debug('ParseForeground BatchesDispatched', {
      batchCount: batches.length,
      paragraphCount: sequenceData.length,
      textLength: sequenceData.reduce((total, [, text]) => total + text.length, 0),
    });

    new ParseCommand(sequenceData).send(afterSend);

    this._pendingBatches.clear();
  }

  private prepareNode(
    node: Element | Node,
    paragraphs: Paragraph[],
    applyFn: typeof applyTokens,
    onComplete?: (node: Element | Node) => void,
    onError?: (node: Element | Node, error: Error) => void,
  ): void {
    const batches = paragraphs.map((paragraph) =>
      Registry.sequenceManager.getAbortableSequence<JitenToken[], Paragraph>(paragraph),
    );

    for (const batch of batches) {
      this._sequenceDiagnostics.set(batch.sequenceId, {
        registeredAt: performance.now(),
        characters: batch.data.reduce((total, fragment) => total + fragment.length, 0),
        fragments: batch.data.length,
      });
    }

    this._pendingBatches.set(node, batches);
    this.prepareBatches(node, applyFn, onComplete, onError);
  }

  private prepareBatches(
    node: HTMLElement | Node,
    applyFn: typeof applyTokens,
    onComplete?: (node: Element | Node) => void,
    onError?: (
      node: Element | Node,
      error: Error,
      context: {
        appliedParagraphCount: number;
        totalParagraphCount: number;
      },
    ) => void,
  ): void {
    const batches = this._pendingBatches.get(node)!;
    let lastError: Error | undefined;
    let wasCanceled = false;
    let appliedParagraphCount = 0;

    // Process paragraphs sequentially to prevent parallel DOM flooding
    void batches
      .reduce(
        (previousPromise, batch) =>
          previousPromise.then(async () => {
            try {
              const diagnostics = this._sequenceDiagnostics.get(batch.sequenceId);
              const value = await batch.promise;
              const receivedAt = performance.now();
              const backgroundWaitMs = diagnostics?.dispatchedAt
                ? receivedAt - diagnostics.dispatchedAt
                : undefined;
              const queueWaitMs = diagnostics ? receivedAt - diagnostics.registeredAt : undefined;
              const applyStartedAt = performance.now();

              await applyFn(batch.data, value);

              debug('ParseForeground ParagraphApplied', {
                applyMs: performance.now() - applyStartedAt,
                backgroundWaitMs,
                characters: diagnostics?.characters ?? 0,
                fragments: diagnostics?.fragments ?? batch.data.length,
                queueWaitMs,
                sequenceId: batch.sequenceId,
                tokenCount: value.length,
              });

              this._sequenceDiagnostics.delete(batch.sequenceId);
              appliedParagraphCount++;
            } catch (error) {
              this._sequenceDiagnostics.delete(batch.sequenceId);

              if (error instanceof Canceled) {
                wasCanceled = true;

                return;
              }

              lastError = error as Error;

              if ((error as Error).message === 'Failed to fetch') {
                displayToast('error', 'api.jiten.moe is unreachable', (error as Error).message);

                return;
              }

              // eslint-disable-next-line no-console
              console.error(error);

              displayToast(
                'error',
                'An error occurred while parsing the text',
                (error as Error).message,
              );
            }
          }),
        Promise.resolve(),
      )
      .then(() => {
        if (wasCanceled) {
          return;
        }

        if (lastError) {
          onError?.(node, lastError, {
            appliedParagraphCount,
            totalParagraphCount: batches.length,
          });

          return;
        }

        onComplete?.(node);
      });
  }
}
