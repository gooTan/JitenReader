import { JitenToken } from '@shared/jiten/types';
import { Fragment, Paragraph } from '../../batches/types';
import { Registry } from '../../integration/registry';
import { TtsuParagraphReader } from '../../paragraph-reader/ttsu.paragraph-reader';
import { AutomaticParser } from '../automatic.parser';
import { VisibleParseScheduler } from '../visible-parse-scheduler';
import { TtsuTextHighlighter } from './ttsu-text-highlighter';

const ttsuApplyTokens = async (fragments: Fragment[], tokens: JitenToken[]): Promise<void> => {
  await new TtsuTextHighlighter(fragments, tokens).apply();
  Registry.statusBar?.recalculateStats();
};

const getTtsuParagraphs = (
  node: Element | Node,
  filter?: (node: Element | Node) => boolean,
  collapseWhitespace?: boolean,
): Paragraph[] => {
  return new TtsuParagraphReader(node, filter, collapseWhitespace).read();
};

export class TtsuParser extends AutomaticParser {
  protected _pageObserver?: MutationObserver;
  protected _chapterObserver?: IntersectionObserver;
  protected _chapterScheduler?: VisibleParseScheduler;
  private _hasReservedFuriganaSpace = false;
  private _observedChapters = new Set<Element>();

  public override destroy(): void {
    this._pageObserver?.disconnect();
    this._chapterObserver?.disconnect();
    this._chapterScheduler?.destroy();
    this._observedChapters.clear();
    super.destroy();
  }

  protected setupVisibleObserver(): void {
    this._visibleObserver = this.getParseVisibleObserver();
  }

  protected visibleObserverOnEnter(elements: HTMLElement[]): void {
    const [element] = elements;
    const container = element.querySelector('.book-content-container');
    const chapters = element.querySelectorAll('[id^="ttu');

    if (container) {
      this._pageObserver = new MutationObserver(() => {
        Registry.sentenceManager.reset();

        this.parseNode(container);
      });

      this._pageObserver.observe(container, {
        attributes: true,
        attributeFilter: ['id'],
      });

      return;
    }

    this.setupChapterObservers(chapters);
  }

  protected visibleObserverOnExit(): void {
    this._pageObserver?.disconnect();
    this._chapterObserver?.disconnect();
    this._chapterScheduler?.demote(
      Array.from(this._observedChapters).filter((chapter) => chapter.isConnected),
    );
  }

  protected override parseNodes(
    nodes: (Node | Element)[],
    filter?: (node: Node | Element) => boolean,
  ): void {
    if (this._destroyed) {
      return;
    }

    this.installAppStyles();
    this.reserveFuriganaSpace();

    const { batchController } = Registry;

    batchController.registerNodes(nodes, {
      filter,
      collapseWhitespace: this._meta.collapseWhitespace,
      getParagraphsFn: getTtsuParagraphs,
      applyFn: ttsuApplyTokens,
      onComplete: () => window.dispatchEvent(new Event('resize')),
    });
    batchController.parseBatches();
  }

  protected setupChapterObservers(chapters: NodeListOf<Element>): void {
    this._chapterObserver?.disconnect();
    this._observedChapters = new Set(
      Array.from(this._observedChapters).filter((chapter) => chapter.isConnected),
    );
    this._chapterObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          this._chapterScheduler?.discover([entry.target], 'visibility');

          continue;
        }

        this._chapterScheduler?.demote([entry.target]);
      }
    });

    if (this._chapterScheduler) {
      this._chapterScheduler.setObserver(this._chapterObserver);
      this._chapterScheduler.resume(this._chapterObserver);
    } else {
      this._chapterScheduler = new VisibleParseScheduler({
        observer: this._chapterObserver,
        createRegisterOptions: (): {
          collapseWhitespace: boolean | undefined;
          getParagraphsFn: typeof getTtsuParagraphs;
          applyFn: typeof ttsuApplyTokens;
          onComplete: () => void;
        } => ({
          collapseWhitespace: this._meta.collapseWhitespace,
          getParagraphsFn: getTtsuParagraphs,
          applyFn: ttsuApplyTokens,
          onComplete: () => window.dispatchEvent(new Event('resize')),
        }),
      });
    }

    for (const chapter of chapters) {
      this._observedChapters.add(chapter);
      this._chapterObserver.observe(chapter);
    }
  }

  private reserveFuriganaSpace(): void {
    if (this._hasReservedFuriganaSpace || Registry.textHighlighterOptions.skipFurigana) {
      return;
    }

    this._hasReservedFuriganaSpace = true;

    const style = document.createElement('style');

    style.setAttribute('data-jiten-style', 'ttsu-furigana-reservation');
    style.textContent = [
      '.book-content-container > *:not(.ttu-book-html-wrapper) > *,',
      '.book-content-container > div.ttu-book-html-wrapper > div.ttu-book-body-wrapper > * {',
      '  padding-top: 10px !important;',
      '}',
      '.book-content--writing-vertical-rl .book-content-container > *:not(.ttu-book-html-wrapper) > *,',
      '.book-content--writing-vertical-rl .book-content-container > div.ttu-book-html-wrapper > div.ttu-book-body-wrapper > * {',
      '  padding-top: 0 !important;',
      '  padding-right: 10px !important;',
      '}',
    ].join('\n');

    document.head.appendChild(style);
    window.dispatchEvent(new Event('resize'));
  }
}
