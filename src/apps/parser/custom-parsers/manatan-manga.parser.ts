import { getConfiguration } from '@shared/configuration/get-configuration';
import { Keybind } from '@shared/configuration/types';
import { getURL } from '@shared/extension/get-url';
import { JitenToken } from '@shared/jiten/types';
import { Paragraph } from '../../batches/types';
import { Registry } from '../../integration/registry';
import { AutomaticParser } from '../automatic.parser';
import { VisibleParseScheduler } from '../visible-parse-scheduler';
import { getManatanMangaParagraphs } from './manatan-manga/get-manatan-manga-paragraphs';
import { manatanMangaApplyTokens } from './manatan-manga/manatan-manga-apply-tokens';

export class ManatanMangaParser extends AutomaticParser {
  private static readonly MAIN_WORLD_CONTROL_EVENT = 'jiten:manatan-caret-patch-control';
  private static readonly MAIN_WORLD_SCRIPT_ID = 'jiten-manatan-main-world-caret-patch';
  private static readonly YOMITAN_PASS_THROUGH_CLASS = 'jiten-manatan-pass-through';
  private static readonly MODIFIER_CODE_MAP: Record<string, string> = {
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Control',
    ControlRight: 'Control',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    MetaLeft: 'Meta',
    MetaRight: 'Meta',
  };
  private _textObservers = new Map<HTMLElement, MutationObserver>();
  private _debounceTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private _popupKeybinds: Keybind[] = [];
  private _pressedCodes = new Set<string>();
  private _keyboardPassThrough = false;
  private _middleClickPassThrough = false;
  private _keydownHandler?: (e: KeyboardEvent) => void;
  private _keyupHandler?: (e: KeyboardEvent) => void;
  private _mousedownHandler?: (e: MouseEvent) => void;
  private _mouseupHandler?: (e: MouseEvent) => void;
  private _auxclickHandler?: (e: MouseEvent) => void;
  private _blurHandler?: () => void;
  private _visibilityHandler?: () => void;
  private _boxScheduler?: VisibleParseScheduler;

  public override destroy(): void {
    this.teardownRuntimeState();
    super.destroy();
  }

  protected override init(): void {
    Registry.sentenceManager.disable();
    this.installMainWorldCaretPatch();
    this.setupYomitanPassThroughToggle();
    void this.loadPopupKeybinds();
  }

  protected override onParsingPaused(): void {
    this.teardownRuntimeState();
  }

  protected override setupVisibleObserver(): void {
    this._visibleObserver = this.getVisibleObserver(
      (elements) => this.handleVisibleBoxes(elements),
      (elements) => this._boxScheduler?.demote(elements),
    );
    this._boxScheduler = new VisibleParseScheduler({
      observer: this._visibleObserver,
      createRegisterOptions: (): {
        collapseWhitespace: boolean | undefined;
        getParagraphsFn: typeof getManatanMangaParagraphs;
        applyFn: (paragraph: Paragraph, tokens: JitenToken[]) => void;
      } => ({
        collapseWhitespace: this._meta.collapseWhitespace,
        getParagraphsFn: getManatanMangaParagraphs,
        applyFn: (paragraph: Paragraph, tokens: JitenToken[]): void => {
          manatanMangaApplyTokens(paragraph, tokens);
        },
      }),
    });
  }

  protected override addedObserverCallback(
    elements: HTMLElement[],
    source: 'initial' | 'mutation' = 'mutation',
  ): void {
    for (const element of elements) {
      this.watchTextChanges(element);
      this._visibleObserver?.observe(element);
    }

    this._boxScheduler?.discover(elements, source);
  }

  protected override removedObserverCallback(
    elements: HTMLElement[],
    source: 'initial' | 'mutation' = 'mutation',
  ): void {
    for (const element of elements) {
      this._textObservers.get(element)?.disconnect();
      this._textObservers.delete(element);

      const debounceTimer = this._debounceTimers.get(element);

      if (debounceTimer) {
        clearTimeout(debounceTimer);
        this._debounceTimers.delete(element);
      }
    }

    this._boxScheduler?.removeElements(elements);
    super.removedObserverCallback(elements, source);
  }

  private installMainWorldCaretPatch(): void {
    const existing = document.getElementById(ManatanMangaParser.MAIN_WORLD_SCRIPT_ID);

    if (existing) {
      this.sendMainWorldPatchControl('install');

      return;
    }

    const script = document.createElement('script');

    script.id = ManatanMangaParser.MAIN_WORLD_SCRIPT_ID;
    script.src = getURL('assets/manatan-main-world-caret-patch.js');
    script.onload = (): void => {
      script.remove();
      this.sendMainWorldPatchControl('install');
    };
    script.onerror = (): void => {
      script.remove();
    };

    (document.head || document.documentElement).appendChild(script);
  }

  private setupYomitanPassThroughToggle(): void {
    this._keydownHandler = (event: KeyboardEvent): void => {
      this._pressedCodes.add(event.code);
      this.updateKeyboardPassThrough();
    };

    this._keyupHandler = (event: KeyboardEvent): void => {
      this._pressedCodes.delete(event.code);
      this.updateKeyboardPassThrough();
    };

    this._mousedownHandler = (event: MouseEvent): void => {
      if (event.button === 1) {
        this._middleClickPassThrough = true;
        this.syncPassThroughClass();
      }
    };

    const releaseMiddlePassThrough = (): void => {
      this._middleClickPassThrough = false;
      this.syncPassThroughClass();
    };

    this._mouseupHandler = (event: MouseEvent): void => {
      if (event.button === 1) {
        setTimeout(releaseMiddlePassThrough, 0);
      }
    };

    this._auxclickHandler = (event: MouseEvent): void => {
      if (event.button === 1) {
        setTimeout(releaseMiddlePassThrough, 0);
      }
    };

    this._blurHandler = (): void => {
      this._pressedCodes.clear();
      this._keyboardPassThrough = false;
      this._middleClickPassThrough = false;
      this.syncPassThroughClass();
    };

    this._visibilityHandler = (): void => {
      if (document.visibilityState !== 'visible') {
        this._pressedCodes.clear();
        this._keyboardPassThrough = false;
        this._middleClickPassThrough = false;
        this.syncPassThroughClass();
      }
    };

    document.addEventListener('keydown', this._keydownHandler);
    document.addEventListener('keyup', this._keyupHandler);
    document.addEventListener('mousedown', this._mousedownHandler, true);
    document.addEventListener('mouseup', this._mouseupHandler, true);
    document.addEventListener('auxclick', this._auxclickHandler, true);
    window.addEventListener('blur', this._blurHandler);
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  private async loadPopupKeybinds(): Promise<void> {
    const raw = await getConfiguration('showPopupKey');

    this._popupKeybinds = (
      Array.isArray(raw) ? raw.filter((v) => v?.code) : raw?.code ? [raw] : []
    ) as Keybind[];

    this.updateKeyboardPassThrough();
  }

  private updateKeyboardPassThrough(): void {
    this._keyboardPassThrough =
      this._pressedCodes.size > 0 && !this.matchesShowPopupKeyFromPressedState();
    this.syncPassThroughClass();
  }

  private matchesShowPopupKeyFromPressedState(): boolean {
    return this._popupKeybinds.some((keybind) => this.matchesKeybindFromPressedState(keybind));
  }

  private matchesKeybindFromPressedState(keybind: Keybind): boolean {
    if (!keybind?.code) {
      return false;
    }

    const required = [...keybind.modifiers, this.mapCodeToState(keybind.code)].filter(Boolean);

    return required.length > 0 && required.every((state) => this.isStatePressed(state));
  }

  private isStatePressed(state: string): boolean {
    switch (state) {
      case 'Shift':
        return this._pressedCodes.has('ShiftLeft') || this._pressedCodes.has('ShiftRight');
      case 'Control':
        return this._pressedCodes.has('ControlLeft') || this._pressedCodes.has('ControlRight');
      case 'Alt':
        return this._pressedCodes.has('AltLeft') || this._pressedCodes.has('AltRight');
      case 'Meta':
        return this._pressedCodes.has('MetaLeft') || this._pressedCodes.has('MetaRight');
      default:
        return this._pressedCodes.has(state);
    }
  }

  private mapCodeToState(code: string): string {
    return ManatanMangaParser.MODIFIER_CODE_MAP[code] ?? code;
  }

  private syncPassThroughClass(): void {
    const passThrough = this._keyboardPassThrough || this._middleClickPassThrough;

    document.body.classList.toggle(ManatanMangaParser.YOMITAN_PASS_THROUGH_CLASS, passThrough);
  }

  private sendMainWorldPatchControl(action: 'install' | 'uninstall'): void {
    window.dispatchEvent(
      new CustomEvent(ManatanMangaParser.MAIN_WORLD_CONTROL_EVENT, {
        detail: { action },
      }),
    );
  }

  private watchTextChanges(box: HTMLElement): void {
    if (this._textObservers.has(box)) {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      const isOverlayChange = mutations.every((m) => {
        if (m.type !== 'childList') {
          return false;
        }

        const nodes = [...m.addedNodes, ...m.removedNodes];

        return (
          nodes.length > 0 &&
          nodes.every(
            (n) => n instanceof HTMLElement && n.classList.contains('jiten-manatan-overlay'),
          )
        );
      });

      if (isOverlayChange) {
        return;
      }

      const existing = this._debounceTimers.get(box);

      if (existing) {
        clearTimeout(existing);
      }

      this._debounceTimers.set(
        box,
        setTimeout(() => {
          this._debounceTimers.delete(box);
          this.reparseTextBox(box);
        }, 300),
      );
    });

    observer.observe(box, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    this._textObservers.set(box, observer);
  }

  private reparseTextBox(box: HTMLElement): void {
    box.querySelector('.jiten-manatan-overlay')?.remove();
    box.removeAttribute('data-jiten-parsed');

    this._visibleObserver?.observe(box);
    this._boxScheduler?.discover([box], 'mutation');
  }

  private handleVisibleBoxes(elements: Element[]): void {
    const boxes = elements.filter((element) => !element.hasAttribute('data-jiten-parsed'));

    if (!boxes.length) {
      return;
    }

    for (const box of boxes) {
      this.watchTextChanges(box as HTMLElement);
    }

    this.installAppStyles();
    this._boxScheduler?.discover(boxes, 'visibility');
  }

  private teardownRuntimeState(): void {
    if (this._keydownHandler) {
      document.removeEventListener('keydown', this._keydownHandler);
    }

    if (this._keyupHandler) {
      document.removeEventListener('keyup', this._keyupHandler);
    }

    if (this._mousedownHandler) {
      document.removeEventListener('mousedown', this._mousedownHandler, true);
    }

    if (this._mouseupHandler) {
      document.removeEventListener('mouseup', this._mouseupHandler, true);
    }

    if (this._auxclickHandler) {
      document.removeEventListener('auxclick', this._auxclickHandler, true);
    }

    if (this._blurHandler) {
      window.removeEventListener('blur', this._blurHandler);
    }

    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
    }

    document.body.classList.remove(ManatanMangaParser.YOMITAN_PASS_THROUGH_CLASS);
    this._pressedCodes.clear();
    this._keyboardPassThrough = false;
    this._middleClickPassThrough = false;
    this._boxScheduler?.destroy();
    this._boxScheduler = undefined;
    this.sendMainWorldPatchControl('uninstall');
    this._textObservers.forEach((obs) => obs.disconnect());
    this._textObservers.clear();
    this._debounceTimers.forEach((t) => clearTimeout(t));
    this._debounceTimers.clear();
  }
}
