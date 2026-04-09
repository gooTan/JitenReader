import { getConfiguration } from '@shared/configuration/get-configuration';
import { createElement } from '@shared/dom/create-element';
import { findElements } from '@shared/dom/find-elements';
import { withElement } from '@shared/dom/with-element';
import { getStyleUrl } from '@shared/extension/get-style-url';
import { JitenCard } from '@shared/jiten/types';
import { ForgetCardCommand } from '@shared/messages/background/forget-card.command';
import { UpdateCardStateCommand } from '@shared/messages/background/update-card-state.command';
import { onBroadcastMessage } from '@shared/messages/receiving/on-broadcast-message';
import { getThemeCssVars } from '@shared/theme/get-theme-css-vars';
import { KeybindManager } from '../integration/keybind-manager';
import { Registry } from '../integration/registry';
import { GradingController } from './actions/grading-controller';
import { MiningController } from './actions/mining-controller';
import { RotationController } from './actions/rotation-controller';
import { ConfirmDialog } from './confirm-dialog';
import { PopupLifecycleController } from './popup-lifecycle-controller';
import { setPopupPosition } from './popup-positioning';
import {
  cardHasState,
  getReviewStateTags,
  renderPopupContext,
  renderPopupDetails,
} from './popup-renderer';

export class Popup {
  private _keyManager = new KeybindManager([], {
    keydown: (e: MouseEvent | KeyboardEvent): void => this.handleKeydown(e),
  });

  /**
   * This is the root element of the popup, which is attached to the host page or iframe.
   * It manages the shadow root isolating the actual popup content.
   */
  private _root: HTMLDivElement = createElement('div', {
    id: 'ajb-popup',
    events: {
      onmousedown: (ev: MouseEvent) => ev.stopPropagation(),
      onclick: (ev: MouseEvent) => ev.stopPropagation(),
      onwheel: (ev: WheelEvent) => ev.stopPropagation(),
    },
    style: {
      all: 'initial',
      zIndex: '2147483647',
      position: 'absolute',
      top: '0',
      left: '0',
      opacity: '0',
      visibility: 'hidden',
    },
  });

  //#region Utility Accessors

  /** Theme CSS variables - syncronised with extension storage */
  private _themeStyles: HTMLStyleElement = createElement('style');
  /** The user declared styles - syncronised with extension storage */
  private _customStyles: HTMLStyleElement = createElement('style');

  private _closeButton = createElement('section', {
    id: 'close',
    class: ['controls'],
    style: {
      display: 'none', // Hidden by default
    },
    children: [
      createElement('a', {
        id: 'close-btn',
        class: ['outline', 'close'],
        handler: () => this.hide(),
      }),
    ],
  });
  /** Contains the buttons to manage the card and its decks */
  private _mineButtons = createElement('section', { id: 'mining', class: ['controls'] });
  /** Contains the buttons to manage the card rotation */
  private _rotateButtons = createElement('section', { id: 'rotation', class: ['controls'] });
  /** Contains the buttons to manage card states */
  private _gradeButtons = createElement('section', { id: 'grading', class: ['controls'] });
  /** Contains the header data - all information about a word except its meaning */
  private _context = createElement('section', { id: 'context' });
  /** Contains the various meanings of a word */
  private _details = createElement('section', { id: 'details' });

  //#endregion

  /**
   * The rendered popup content itself
   */
  private _popup: HTMLDivElement = createElement('div', {
    class: ['popup'],
    events: {
      onmouseenter: () => this.startHover(),
      onmouseleave: () => this.stopHover(),
    },
    children: [],
  });

  private _touchscreenSupport: boolean;
  private _renderCloseButton: boolean;
  private _hidePopupAutomatically: boolean;
  private _hidePopupDelay: number;
  private _hideAfterAction: boolean;
  private _disableFadeAnimation: boolean;
  private _leftAlignPopupToWord: boolean;
  private _moveMiningActions: boolean;
  private _moveRotationActions: boolean;
  private _moveGradingActions: boolean;
  private _showConjugations: boolean;
  private _showPitchDiagrams: boolean;
  private _disableHeadWordLink: boolean;

  private _confirmDialog?: ConfirmDialog;
  private _popupLeft = 0;
  private _popupTop = 0;
  private _lifecycle = new PopupLifecycleController({
    confirmDialogOpen: (): boolean => this._confirmDialog?.isOpen ?? false,
    hide: (): void => this.hide(),
    hidePopupAutomatically: (): boolean => this._hidePopupAutomatically,
    hidePopupDelay: (): number => this._hidePopupDelay,
    isVisible: (): boolean => this.isVisibile(),
  });

  private _cardContext?: HTMLElement;
  private _conjugations?: string[];
  private _card?: JitenCard;
  private _sentence?: string;

  constructor(
    private _mining: MiningController,
    private _rotation: RotationController,
    private _grading: GradingController,
  ) {
    this.renderNodes();

    onBroadcastMessage('cardStateUpdated', (wordId, readingIndex) => {
      setTimeout(() => {
        const currentCard = this._card;

        if (!currentCard) {
          return;
        }

        if (currentCard.wordId !== wordId || currentCard.readingIndex !== readingIndex) {
          return;
        }

        this._card = Registry.getCard(wordId, readingIndex);

        if (this._hideAfterAction) {
          return this.hide();
        }

        this.rerender();
      }, 1);
    });
    onBroadcastMessage('configurationUpdated', () => this.applyConfiguration(), true);
  }

  public show(context: HTMLElement, sentence?: string): void {
    this._cardContext = context;
    this._card = Registry.getCardFromElement(context);
    this._sentence = sentence;
    this._conjugations = Registry.getConjugations(context);

    this._lifecycle.clearTimer();
    this.updateParentElement();
    this.rerender();
    this.setPosition();

    Object.assign<CSSStyleDeclaration, Partial<CSSStyleDeclaration>>(this._root.style, {
      transition: this._disableFadeAnimation ? 'none' : 'opacity 60ms ease-in, visibility 60ms',
      opacity: '1',
      visibility: 'visible',
    });

    this._keyManager.activate();
  }

  public hide(): void {
    Object.assign<CSSStyleDeclaration, Partial<CSSStyleDeclaration>>(this._root.style, {
      transition: this._disableFadeAnimation ? 'none' : 'opacity 200ms ease-in, visibility 20ms',
      opacity: '0',
      visibility: 'hidden',
    });

    this._keyManager.deactivate();
  }

  public initHide(): void {
    this._lifecycle.initHide();
  }

  public disablePointerEvents(): void {
    this._root.style.pointerEvents = 'none';
    this._root.style.userSelect = 'none';
  }

  public enablePointerEvents(): void {
    this._root.style.pointerEvents = '';
    this._root.style.userSelect = '';
  }

  //#region Configuration

  private async applyConfiguration(): Promise<void> {
    this._hidePopupAutomatically = await getConfiguration('hidePopupAutomatically');
    this._hidePopupDelay = await getConfiguration('hidePopupDelay');
    this._hideAfterAction = await getConfiguration('hideAfterAction');
    this._disableFadeAnimation = await getConfiguration('disableFadeAnimation');
    this._leftAlignPopupToWord = await getConfiguration('leftAlignPopupToWord');

    this._renderCloseButton = await getConfiguration('renderCloseButton');
    this._touchscreenSupport = await getConfiguration('touchscreenSupport');
    this._moveMiningActions = await getConfiguration('moveMiningActions');
    this._moveRotationActions = await getConfiguration('moveRotateActions');
    this._moveGradingActions = await getConfiguration('moveGradingActions');
    this._showConjugations = await getConfiguration('showConjugations');
    this._showPitchDiagrams = await getConfiguration('showPitchDiagrams');
    this._disableHeadWordLink = await getConfiguration('disableHeadWordLink');

    this._themeStyles.textContent = await getThemeCssVars();
    this._customStyles.textContent = await getConfiguration('customPopupCSS');

    this._closeButton.style.display =
      this._touchscreenSupport && this._renderCloseButton ? 'flex' : 'none';

    this.updateMiningButtons();
    this.updateRotationButtons();
    this.updateGradingButtons();
    this.applyPositions();
  }

  //#endregion
  //#region Install the popup

  /**
   * Installs all components and initializes the shadow root
   */
  private renderNodes(): void {
    const shadowRoot = this._root.attachShadow({ mode: 'closed' });

    shadowRoot.append(
      createElement('link', { attributes: { rel: 'stylesheet', href: getStyleUrl('popup') } }),
      this._themeStyles,
      this._customStyles,
      this._popup,
    );

    this._confirmDialog = new ConfirmDialog(shadowRoot, () => ({
      x: this._popupLeft,
      y: this._popupTop,
    }));
  }

  private updateParentElement(): void {
    const parentElement = this.getParentElement();

    if (!this._root.parentElement?.isSameNode(parentElement)) {
      parentElement.appendChild(this._root);
    }
  }

  private getParentElement(): HTMLElement {
    const fullscreenVideoElement = this.getFullscreenVideoElement();

    if (fullscreenVideoElement?.parentElement) {
      return this.findElementForFullscreenVideoDisplay(fullscreenVideoElement);
    }

    return document.body;
  }

  private getFullscreenVideoElement(): HTMLElement | undefined {
    if (!document.fullscreenElement) {
      return;
    }

    return findElements('video').find((videoElement) =>
      document.fullscreenElement!.contains(videoElement),
    );
  }

  private findElementForFullscreenVideoDisplay(videoElement: HTMLElement): HTMLElement {
    let currentNode: HTMLElement | null = videoElement.parentElement;
    let chosenNode: HTMLElement | undefined;

    const testNode = document.createElement('div');

    testNode.style.position = 'absolute';
    testNode.style.zIndex = '2147483647';
    testNode.innerText = '&nbsp;'; // The node needs to take up some space to perform test clicks

    while (currentNode && !currentNode.isSameNode(document.body.parentElement)) {
      const rect = currentNode.getBoundingClientRect();

      if (
        rect.height > 0 &&
        (chosenNode === undefined || rect.height >= chosenNode.getBoundingClientRect().height) &&
        this.elementIsClickableInsideContainer(currentNode, testNode)
      ) {
        chosenNode = currentNode;

        break;
      }

      currentNode = currentNode.parentElement;
    }

    return chosenNode ?? document.body;
  }

  private elementIsClickableInsideContainer(container: HTMLElement, element: HTMLElement): boolean {
    container.appendChild(element);

    const rect = element.getBoundingClientRect();
    const clickedElement = document.elementFromPoint(rect.x, rect.y);
    const clickable = element.isSameNode(clickedElement) || element.contains(clickedElement);

    element.remove();

    return clickable;
  }

  //#endregion
  //#region Position the popup

  private setPosition(): void {
    const { left, top } = setPopupPosition({
      cardContext: this._cardContext!,
      leftAlignPopupToWord: this._leftAlignPopupToWord,
      popup: this._popup,
      root: this._root,
    });

    this._popupLeft = left;
    this._popupTop = top;
  }

  //#endregion
  //#region Button Renderer

  private updateMiningButtons(): void {
    const performDeckAction = (
      action: 'add' | 'remove',
      key: 'mining' | 'neverForget' | 'blacklist' | 'suspend',
      sentence?: string,
    ): void => this._mining.addOrRemove(action, key, this._card!, sentence);
    const performFlaggedDeckAction = (key: 'neverForget' | 'blacklist' | 'suspend'): void => {
      const action = cardHasState(key, this._card!) ? 'remove' : 'add';

      performDeckAction(action, key);
    };

    this._mineButtons.replaceChildren();
    this._mineButtons.style.display = this._mining.showActions ? '' : 'none';

    // this.addMiningButton("mining", 'mining', 'Add', () =>
    //   performDeckAction('add', 'mining', this._sentence),
    // );

    this.addMiningButton('neverForget', 'never-forget', undefined, () =>
      performFlaggedDeckAction('neverForget'),
    );
    this.addMiningButton('blacklist', 'blacklist', undefined, () =>
      performFlaggedDeckAction('blacklist'),
    );
    // this.addMiningButton(this._mining.suspendDeck, 'suspend', undefined, () =>
    //   performFlaggedDeckAction('suspend'),
    // );

    this._mineButtons.appendChild(
      createElement('a', {
        id: 'forget-deck',
        class: ['outline', 'forget'],
        innerText: 'Forget',
        handler: () => void this.handleForgetClick(),
      }),
    );
  }

  private async handleForgetClick(): Promise<void> {
    if (!this._card || !this._confirmDialog) {
      return;
    }

    const confirmed = await this._confirmDialog.show({
      message: 'Forget this card? The card state and all reviews will be permanently deleted.',
      confirmText: 'Forget',
      cancelText: 'Cancel',
      confirmClass: 'forget',
    });

    if (!confirmed) {
      return;
    }

    const { wordId, readingIndex } = this._card;

    new ForgetCardCommand(wordId, readingIndex).send(() => {
      new UpdateCardStateCommand(wordId, readingIndex).send();
    });
  }

  private addMiningButton(
    deck: string | undefined,
    id: string,
    text?: string,
    handler?: () => void,
  ): void {
    if (!deck?.length) {
      return;
    }

    this._mineButtons.appendChild(
      createElement('a', {
        id: `${id}-deck`,
        class: ['outline', id],
        innerText: text,
        handler,
      }),
    );
  }

  private updateRotationButtons(): void {
    const previous = createElement('a', {
      id: 'previous',
      class: ['outline', 'previous'],
      innerText: 'Previous',
      handler: () => this._rotation.rotate(this._card!, -1),
    });
    const next = createElement('a', {
      id: 'next',
      class: ['outline', 'next'],
      innerText: 'Next',
      handler: () => this._rotation.rotate(this._card!, 1),
    });

    this._rotateButtons.replaceChildren(previous, next);
    this._rotateButtons.style.display = this._rotation.showActions ? '' : 'none';
  }

  private updateGradingButtons(): void {
    const gradeButtons = this._grading.getGradingActions().map((grade) =>
      createElement('a', {
        id: grade,
        class: ['outline', grade],
        innerText: grade,
        handler: () => this._grading.gradeCard(this._card!, grade),
      }),
    );

    this._gradeButtons.replaceChildren(...gradeButtons);
    this._gradeButtons.style.display = this._grading.showActions ? '' : 'none';
  }

  private applyPositions(): void {
    const sections = [this._closeButton, this._context, this._details];
    const before: HTMLElement[] = [];
    const after: HTMLElement[] = [];

    const miningTarget = this._moveMiningActions ? after : before;
    const rotationTarget = this._moveRotationActions ? after : before;
    const gradingTarget = this._moveGradingActions ? after : before;

    miningTarget.push(this._mineButtons);
    rotationTarget.push(this._rotateButtons);
    gradingTarget.push(this._gradeButtons);

    sections.unshift(...before);
    sections.push(...after);

    this._popup.replaceChildren(...sections);
  }

  //#endregion
  //#region On showing a popup

  private rerender(): void {
    if (!this._card) {
      return;
    }

    this.adjustMiningButtons(this._card);
    this.adjustRotateButtons(this._card);
    this.adjustContext(this._card);
    this.adjustDetails(this._card);

    this._popup.setAttribute('class', `popup ${getReviewStateTags(this._card).join(' ')}`);
  }

  private adjustMiningButtons(card: JitenCard): void {
    const isNF = cardHasState('neverForget', card);
    const isBL = cardHasState('blacklist', card);
    const isSP = cardHasState('suspend', card);

    withElement(this._mineButtons, '#never-forget-deck', (el) => {
      el.innerText = isNF ? 'Remove Never Forget' : 'Never forget';
    });
    withElement(this._mineButtons, '#blacklist-deck', (el) => {
      el.innerText = isBL ? 'Remove Blacklist' : 'Blacklist';
    });
    withElement(this._mineButtons, '#suspend-deck', (el) => {
      el.innerText = isSP ? 'Unsuspend' : 'Suspend';
    });
  }

  private adjustRotateButtons(card: JitenCard): void {
    const previous = this._rotation.getNextCardState(card, -1);
    const next = this._rotation.getNextCardState(card, 1);
    const same = previous === next;

    const getText = (state: string | undefined, arrow?: 'left' | 'right'): string => {
      const text = !state
        ? 'Unflag'
        : state
            .replace(/^\w/, (c) => c.toUpperCase())
            .replace(/([a-z])([A-Z])/g, (c) => `${c[0]} ${c[1].toLowerCase()}`);

      if (arrow === 'left') {
        return `← ${text}`;
      }

      if (arrow === 'right') {
        return `${text} →`;
      }

      return text;
    };
    const getCls = (state: string | undefined): string => {
      if (!state) {
        return '';
      }

      return state.replace(/([a-z])([A-Z])/g, (c) => `${c[0]}-${c[1].toLowerCase()}`);
    };

    withElement(this._rotateButtons, '#previous', (el) => {
      el.style.display = same ? 'none' : '';
      el.innerText = getText(previous, 'left');

      el.setAttribute('class', `outline previous ${getCls(previous)}`);
    });

    withElement(this._rotateButtons, '#next', (el) => {
      el.innerText = getText(next, same ? undefined : 'right');

      el.setAttribute('class', `outline next ${getCls(next)}`);
    });
  }

  private adjustContext(card: JitenCard): void {
    this._context.replaceChildren(
      ...renderPopupContext({
        card,
        disableHeadWordLink: this._disableHeadWordLink,
        showPitchDiagrams: this._showPitchDiagrams,
      }),
    );
  }

  private adjustDetails(card: JitenCard): void {
    this._details.replaceChildren(
      ...renderPopupDetails({
        card,
        conjugations: this._conjugations,
        showConjugations: this._showConjugations,
      }),
    );
  }

  //#endregion
  //#region Others

  private isVisibile(): boolean {
    return this._root.style.visibility === 'visible';
  }

  private startHover(): void {
    this._lifecycle.startHover();
  }

  private stopHover(): void {
    this._lifecycle.stopHover();
  }

  private handleKeydown(e: MouseEvent | KeyboardEvent): void {
    if (!document.hasFocus()) {
      return;
    }

    if (e && 'key' in e && e.key === 'Escape' && this.isVisibile()) {
      e.stopPropagation();

      this.hide();
    }

    if ('button' in e && e.button === 0 && this.isVisibile() && !this._lifecycle.isHover) {
      e.stopPropagation();

      this.hide();
    }
  }

  //#endregion
}
