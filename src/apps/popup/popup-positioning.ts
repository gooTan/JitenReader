export interface SetPopupPositionArgs {
  cardContext: HTMLElement;
  leftAlignPopupToWord: boolean;
  popup: HTMLDivElement;
  root: HTMLDivElement;
}

export interface PopupPosition {
  left: number;
  top: number;
}

export function setPopupPosition({
  cardContext,
  leftAlignPopupToWord,
  popup,
  root,
}: SetPopupPositionArgs): PopupPosition {
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);
  const { writingMode } = getComputedStyle(cardContext);
  const { x, y } = cardContext.getBoundingClientRect();
  const { offsetWidth: popupWidth, offsetHeight: popupHeight } = popup;
  const { innerWidth, innerHeight, scrollX, scrollY } = window;
  const { top, right, bottom, left } = getClosestClientRect(cardContext, x, y);

  root.style.width = '';
  popup.style.width = '';

  const wordLeft = scrollX + left;
  const wordTop = scrollY + top;
  const wordRight = scrollX + right;
  const wordBottom = scrollY + bottom;

  const leftSpace = left;
  const topSpace = top;
  const rightSpace = innerWidth - right;
  const bottomSpace = innerHeight - bottom;

  const minLeft = scrollX;
  const maxLeft = scrollX + innerWidth - popupWidth;
  const minTop = scrollY;
  const maxTop = scrollY + innerHeight - popupHeight;

  let popupLeft: number;
  let popupTop: number;

  if (writingMode.startsWith('horizontal')) {
    popupTop = clamp(bottomSpace > topSpace ? wordBottom : wordTop - popupHeight, minTop, maxTop);
    popupLeft = clamp(rightSpace > leftSpace ? wordLeft : wordRight - popupWidth, minLeft, maxLeft);
  } else {
    popupTop = clamp(bottomSpace > topSpace ? wordTop : wordBottom - popupHeight, minTop, maxTop);
    popupLeft = clamp(rightSpace > leftSpace ? wordRight : wordLeft - popupWidth, minLeft, maxLeft);
  }

  if (leftAlignPopupToWord) {
    popupLeft = Math.min(wordLeft, innerWidth - popupWidth - 8);
  }

  if (innerWidth < 450) {
    popupLeft = 8;
    root.style.width = `${innerWidth - 32}px`;
    popup.style.width = `${innerWidth - 32}px`;
  }

  root.style.transform = `translate(${popupLeft}px, ${popupTop}px)`;

  return {
    left: popupLeft,
    top: popupTop,
  };
}

function getClosestClientRect(elem: HTMLElement, x: number, y: number): DOMRect {
  const rects = elem.getClientRects();

  if (rects.length === 1) {
    return rects[0];
  }

  const { writingMode } = getComputedStyle(elem);
  const horizontal = writingMode.startsWith('horizontal');
  const mergedRects = [];

  for (const rect of rects) {
    if (mergedRects.length === 0) {
      mergedRects.push(rect);

      continue;
    }

    const prevRect: DOMRect = mergedRects[mergedRects.length - 1];

    if (horizontal) {
      if (rect.bottom === prevRect.bottom && rect.left === prevRect.right) {
        mergedRects[mergedRects.length - 1] = new DOMRect(
          prevRect.x,
          prevRect.y,
          rect.right - prevRect.left,
          prevRect.height,
        );
      } else {
        mergedRects.push(rect);
      }
    } else {
      if (rect.right === prevRect.right && rect.top === prevRect.bottom) {
        mergedRects[mergedRects.length - 1] = new DOMRect(
          prevRect.x,
          prevRect.y,
          prevRect.width,
          rect.bottom - prevRect.top,
        );
      } else {
        mergedRects.push(rect);
      }
    }
  }

  return mergedRects
    .map((rect) => ({
      rect,
      distance:
        Math.max(rect.left - x, 0, x - rect.right) ** 2 +
        Math.max(rect.top - y, 0, y - rect.bottom) ** 2,
    }))
    .reduce((a, b) => (a.distance <= b.distance ? a : b)).rect;
}
