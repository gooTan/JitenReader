export interface PopupLifecycleControllerOptions {
  confirmDialogOpen: () => boolean;
  hide: () => void;
  hidePopupAutomatically: () => boolean;
  hidePopupDelay: () => number;
  isVisible: () => boolean;
}

export class PopupLifecycleController {
  private _hideTimer?: NodeJS.Timeout;
  private _isHover = false;

  constructor(private _options: PopupLifecycleControllerOptions) {}

  public get isHover(): boolean {
    return this._isHover;
  }

  public clearTimer(): void {
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
    }
  }

  public initHide(): void {
    if (!this._options.hidePopupAutomatically()) {
      return;
    }

    if (!this._options.hidePopupDelay()) {
      this._options.hide();

      return;
    }

    this.startTimer();
  }

  public startHover(): void {
    if (!this._options.isVisible()) {
      return;
    }

    this._isHover = true;
    this.clearTimer();
  }

  public stopHover(): void {
    this._isHover = false;

    if (!this._options.isVisible()) {
      return;
    }

    if (this._options.confirmDialogOpen()) {
      return;
    }

    if (!this._options.hidePopupAutomatically()) {
      return;
    }

    if (!this._options.hidePopupDelay()) {
      this._options.hide();

      return;
    }

    this.startTimer();
  }

  private startTimer(): void {
    this.clearTimer();

    this._hideTimer = setTimeout(() => this._options.hide(), this._options.hidePopupDelay());
  }
}
