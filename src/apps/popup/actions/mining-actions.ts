import { JitenCard, JitenCardState } from '@shared/jiten/types';
import { RunDeckActionCommand } from '@shared/messages/background/run-deck-action.command';
import { KeybindManager } from '../../integration/keybind-manager';
import { Registry } from '../../integration/registry';
import { MiningController } from './mining-controller';

export class MiningActions {
  private static readonly STATE_MAP: Record<string, JitenCardState> = {
    neverForget: JitenCardState.MASTERED,
    blacklist: JitenCardState.BLACKLISTED,
    suspend: JitenCardState.BLACKLISTED,
  };

  private _keyManager = new KeybindManager([
    'addToMiningKey',
    'addToBlacklistKey',
    'addToNeverForgetKey',
    'addToSuspendedKey',
    'cycleMasterBlacklistKey',
  ]);

  private _card?: JitenCard;
  private _sentence?: string;

  private _pendingCard?: JitenCard;
  private _originalCardState?: JitenCardState[];
  private _cycleTimer?: ReturnType<typeof setTimeout>;

  constructor(private _controller: MiningController) {
    const { events } = Registry;

    events.on('addToMiningKey', () => this.addToDeck('mining'));
    events.on('addToBlacklistKey', () => this.addToDeck('blacklist'));
    events.on('addToNeverForgetKey', () => this.addToDeck('neverForget'));
    events.on('addToSuspendedKey', () => this.addToDeck('suspend'));
    events.on('cycleMasterBlacklistKey', () => this.cycleMasterBlacklist());
  }

  public activate(context: HTMLElement, sentence?: string): void {
    this._card = Registry.getCardFromElement(context);
    this._sentence = sentence;

    if (this.isUnavailableInAnkiMode()) {
      this._keyManager.deactivate();

      return;
    }

    this._keyManager.activate();
  }

  public deactivate(): void {
    this._card = undefined;
    this._sentence = undefined;

    this._keyManager.deactivate();
  }

  private addToDeck(key: 'mining' | 'blacklist' | 'neverForget' | 'suspend'): void {
    if (!this._card || this.isUnavailableInAnkiMode()) {
      return;
    }

    const state = MiningActions.STATE_MAP[key];
    const action = state && this.getStateTags(this._card).includes(state) ? 'remove' : 'add';

    this._controller.addOrRemove(action, key, this._card, this._sentence);
  }

  private cycleMasterBlacklist(): void {
    if (!this._card || this.isUnavailableInAnkiMode()) {
      return;
    }

    const card = this._card;
    const { wordId, readingIndex } = card;

    if (this._pendingCard?.wordId !== wordId || this._pendingCard?.readingIndex !== readingIndex) {
      this._originalCardState = [...this.getStateTags(card)];
      this._pendingCard = card;
    }

    const nextState = this.getNextCycleState(this.getStateTags(card));
    const nextReviewMetadata = {
      ...card.reviewMetadata,
      freshness: 'stale' as const,
      dueState: nextState.includes(JitenCardState.DUE) ? 'due' : 'notDue',
      resolutionStatus: 'resolved' as const,
      mappingOutcome: nextState.length > 0 ? ('selected' as const) : ('none' as const),
      target: nextState.length > 0 ? card.reviewMetadata.target : undefined,
      stateTags: nextState,
    };

    Registry.updateCard(wordId, readingIndex, nextReviewMetadata);

    if (this._cycleTimer) {
      clearTimeout(this._cycleTimer);
    }

    this._cycleTimer = setTimeout(() => this.flushCycle(), 400);
  }

  private getNextCycleState(cardState: JitenCardState[]): JitenCardState[] {
    const next = cardState.filter(
      (s) => s !== JitenCardState.MASTERED && s !== JitenCardState.BLACKLISTED,
    );

    if (cardState.includes(JitenCardState.MASTERED)) {
      next.push(JitenCardState.BLACKLISTED);
    } else if (!cardState.includes(JitenCardState.BLACKLISTED)) {
      next.push(JitenCardState.MASTERED);
    }

    return next;
  }

  private flushCycle(): void {
    this._cycleTimer = undefined;

    const card = this._pendingCard;
    const original = this._originalCardState;

    if (!card || !original) {
      return;
    }

    this._pendingCard = undefined;
    this._originalCardState = undefined;

    const hadMastered = original.includes(JitenCardState.MASTERED);
    const hadBlacklisted = original.includes(JitenCardState.BLACKLISTED);
    const updatedStates = this.getStateTags(card);
    const hasMastered = updatedStates.includes(JitenCardState.MASTERED);
    const hasBlacklisted = updatedStates.includes(JitenCardState.BLACKLISTED);

    const instructions: RunDeckActionCommand[] = [];

    if (hadMastered !== hasMastered) {
      instructions.push(
        new RunDeckActionCommand(
          card.wordId,
          card.readingIndex,
          'neverForget',
          hasMastered ? 'add' : 'remove',
        ),
      );
    }

    if (hadBlacklisted !== hasBlacklisted) {
      instructions.push(
        new RunDeckActionCommand(
          card.wordId,
          card.readingIndex,
          'blacklist',
          hasBlacklisted ? 'add' : 'remove',
        ),
      );
    }

    if (instructions.length === 0) {
      return;
    }

    this._controller.suspendUpdateWordStates();

    const executeInstructions = (index: number): void => {
      if (index < instructions.length) {
        instructions[index].send(() => executeInstructions(index + 1));
      } else {
        this._controller.resumeUpdateWordStates(card);
      }
    };

    executeInstructions(0);
  }

  private getStateTags(card: JitenCard): JitenCardState[] {
    return card.reviewMetadata?.stateTags ?? card.cardState;
  }

  private isUnavailableInAnkiMode(): boolean {
    return this._card?.reviewMetadata.backend === 'anki';
  }
}
