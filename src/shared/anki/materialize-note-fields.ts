import { ReviewTermSnapshot } from '@shared/jiten/types';
import { TemplateTarget } from './types';
import { NormalizedAnkiWriteTarget } from './write-target';

export type MaterializedAnkiNoteFields = Record<string, string>;

/**
 * Produce a mapping of Anki note field names to their materialized string values for a given write target and term.
 *
 * @param target - The normalized write target that defines which fields and template targets to populate
 * @param term - The review term snapshot whose properties (spelling, reading, meaning, sentence, frequency, etc.) are used to materialize values
 * @param includeSentenceFields - If `false`, sentence-related template fields are left empty; otherwise they may be populated from `term.sentence`
 * @returns A record mapping field identifiers to their materialized string values. The target's word field is set to `term.spelling`; the reading field is included only if the target configures one; each template target's configured field is populated with its materialized value.
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

/**
 * Count how many sentence-related template targets would materialize to non-empty values for a term.
 *
 * @param target - The Anki write target whose `templateTargets` will be evaluated
 * @param term - The term snapshot used to materialize template values
 * @param includeSentenceFields - If `false`, sentence templates are ignored and the function returns 0
 * @returns The number of `sentence` or `sentenceSanitized` template targets that produce a non-empty string when materialized
 */
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

/**
 * Sanitizes a sentence by trimming leading/trailing whitespace and collapsing contiguous whitespace into single spaces.
 *
 * @param value - The input sentence to sanitize; may be `undefined` or an empty string.
 * @returns The sanitized string, or an empty string if `value` is missing or empty.
 */
export function sanitiseSentence(value?: string): string {
  if (!value?.length) {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Produce the materialized string for a single template target based on the provided term.
 *
 * @param templateTarget - The template target to materialize; its `template` determines which field or transformation to produce (e.g., `spelling`, `reading`, `sentence`, `isKanji`, `hiragana`, `frequency`, etc.).
 * @param term - The review term snapshot providing source values (spelling, reading, meaning, sentence, frequencyRank).
 * @param includeSentenceFields - When `false`, templates related to sentences produce an empty string; when `true`, they produce the term's sentence or a sanitized variant.
 * @returns The rendered string for the given template target (for `isKanji` returns `"true"` or `"false"`, sentence templates return the sentence or `""`, `sound:silence` returns the silence sound tag, frequency templates return formatted numeric strings, and unrecognized templates return `""`).
 */
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

/**
 * Determines whether a string contains any kanji characters.
 *
 * @param value - The string to test for kanji characters
 * @returns `true` if the string contains one or more kanji characters or related Japanese ideographic symbols, `false` otherwise
 */
function hasKanji(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9faf々〆ヵヶ]/.test(value);
}

/**
 * Converts Katakana characters in the input to their Hiragana equivalents.
 *
 * Only characters in the Katakana ranges U+30A1–U+30FA and U+30FC are converted; all other characters are left unchanged.
 *
 * @param value - The string to convert
 * @returns The input string with Katakana characters replaced by their Hiragana equivalents
 */
function katakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30fa\u30fc]/g, (char) => {
    const code = char.charCodeAt(0);

    if (code < 0x30a1 || code > 0x30fa) {
      return char;
    }

    return String.fromCharCode(code - 0x60);
  });
}

/**
 * Format a positive frequency rank as a floored integer string.
 *
 * @param frequencyRank - The frequency rank to format; may be any numeric value
 * @returns `''` if `frequencyRank` is not finite or is less than or equal to 0, otherwise the floored integer value of `frequencyRank` as a string
 */
function formatFrequency(frequencyRank: number): string {
  if (!Number.isFinite(frequencyRank) || frequencyRank <= 0) {
    return '';
  }

  return String(Math.floor(frequencyRank));
}

/**
 * Produce a stylized frequency string prefixed with `#` for a valid frequency rank.
 *
 * @param frequencyRank - The numeric frequency rank to format; non-positive or non-finite values are treated as invalid.
 * @returns `#<n>` where `<n>` is the floored frequency rank when valid, `''` otherwise.
 */
function formatStylisedFrequency(frequencyRank: number): string {
  const frequency = formatFrequency(frequencyRank);

  return frequency.length > 0 ? `#${frequency}` : '';
}
