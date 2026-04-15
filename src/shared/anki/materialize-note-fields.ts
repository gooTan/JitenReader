import { ReviewTermSnapshot } from '@shared/jiten/types';
import { TemplateTarget } from './types';
import { NormalizedAnkiWriteTarget } from './write-target';

export type MaterializedAnkiNoteFields = Record<string, string>;

export function materializeAnkiNoteFields(
  target: NormalizedAnkiWriteTarget,
  term: ReviewTermSnapshot,
  includeSentenceFields = true,
): MaterializedAnkiNoteFields {
  const fields: MaterializedAnkiNoteFields = {
    [target.wordField]: term.spelling,
  };

  if (target.readingField.length > 0) {
    fields[target.readingField] = term.reading;
  }

  for (const templateTarget of target.templateTargets) {
    fields[templateTarget.field] = materializeTemplateValue(
      templateTarget,
      term,
      includeSentenceFields,
    );
  }

  return fields;
}

export function getMaterializedSentenceFieldCount(
  target: NormalizedAnkiWriteTarget,
  term: ReviewTermSnapshot,
  includeSentenceFields = true,
): number {
  if (!includeSentenceFields) {
    return 0;
  }

  return target.templateTargets.filter((templateTarget) => {
    if (templateTarget.template !== 'sentence' && templateTarget.template !== 'sentenceSanitized') {
      return false;
    }

    return materializeTemplateValue(templateTarget, term, includeSentenceFields).length > 0;
  }).length;
}

export function sanitiseSentence(value?: string): string {
  if (!value?.length) {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ');
}

function materializeTemplateValue(
  templateTarget: TemplateTarget,
  term: ReviewTermSnapshot,
  includeSentenceFields: boolean,
): string {
  switch (templateTarget.template) {
    case 'empty':
      return '';
    case 'spelling':
      return term.spelling;
    case 'reading':
      return term.reading;
    case 'isKanji':
      return hasKanji(term.spelling) ? 'true' : 'false';
    case 'meaning':
      return term.meaning;
    case 'sentence':
      return includeSentenceFields ? (term.sentence ?? '') : '';
    case 'sentenceSanitized':
      return includeSentenceFields ? sanitiseSentence(term.sentence) : '';
    case 'sound:silence':
      return '[sound:_silence.wav]';
    case 'hiragana':
      return katakanaToHiragana(term.reading || term.spelling);
    case 'frequency':
      return formatFrequency(term.frequencyRank);
    case 'frequencyStylized':
      return formatStylisedFrequency(term.frequencyRank);
    default:
      return '';
  }
}

function hasKanji(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9faf々〆ヵヶ]/.test(value);
}

function katakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30fa\u30fc]/g, (char) => {
    const code = char.charCodeAt(0);

    if (code < 0x30a1 || code > 0x30fa) {
      return char;
    }

    return String.fromCharCode(code - 0x60);
  });
}

function formatFrequency(frequencyRank: number): string {
  if (!Number.isFinite(frequencyRank) || frequencyRank <= 0) {
    return '';
  }

  return String(Math.floor(frequencyRank));
}

function formatStylisedFrequency(frequencyRank: number): string {
  const frequency = formatFrequency(frequencyRank);

  return frequency.length > 0 ? `#${frequency}` : '';
}
