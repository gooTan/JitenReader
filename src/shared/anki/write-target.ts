import { debug } from '@shared/debug';
import { AnkiFieldTemplateName, DeckConfiguration, TemplateTarget } from './types';

export type AnkiWriteTargetIssueCode =
  | 'missing-deck'
  | 'missing-model'
  | 'missing-word-field'
  | 'missing-template-targets'
  | 'missing-card-template-ord'
  | 'ambiguous-card-template-ord';

export type NormalizedAnkiWriteTarget = {
  deck: string;
  model: string;
  wordField: string;
  readingField: string;
  cardTemplateOrd: number;
  templateTargets: TemplateTarget[];
};

export type ResolveAnkiWriteTargetResult =
  | {
      available: true;
      target: NormalizedAnkiWriteTarget;
    }
  | {
      available: false;
      reason: AnkiWriteTargetIssueCode;
    };

const ANKI_FIELD_TEMPLATE_NAMES: readonly AnkiFieldTemplateName[] = [
  'empty',
  'spelling',
  'reading',
  'isKanji',
  'meaning',
  'sentence',
  'sentenceSanitized',
  'sound:silence',
  'hiragana',
  'frequency',
  'frequencyStylized',
];

const ANKI_FIELD_TEMPLATE_NAME_SET = new Set<AnkiFieldTemplateName>(ANKI_FIELD_TEMPLATE_NAMES);

function isAnkiFieldTemplateName(template: string): template is AnkiFieldTemplateName {
  return ANKI_FIELD_TEMPLATE_NAME_SET.has(template as AnkiFieldTemplateName);
}

export function ResolveAnkiWriteTarget(
  miningConfig: DeckConfiguration,
): ResolveAnkiWriteTargetResult {
  const deck = miningConfig.deck.trim();
  const model = miningConfig.model.trim();
  const wordField = miningConfig.wordField.trim();
  const readingField = miningConfig.readingField.trim();
  const templateTargets = miningConfig.templateTargets.flatMap((target) => {
    const field = target.field.trim();
    const template = target.template.trim();

    if (!field.length || !template.length) {
      return [];
    }

    if (!isAnkiFieldTemplateName(template)) {
      debug('ResolveAnkiWriteTarget: Unknown template target', {
        field: target.field,
        template: target.template,
      });

      return [];
    }

    return [{ field, template }];
  });
  const cardTemplateOrds = Array.from(
    new Set(
      miningConfig.cardTemplateOrds.filter((ord) => {
        return Number.isInteger(ord) && ord >= 0;
      }),
    ),
  );

  if (!deck.length) {
    return {
      available: false,
      reason: 'missing-deck',
    };
  }

  if (!model.length) {
    return {
      available: false,
      reason: 'missing-model',
    };
  }

  if (!wordField.length) {
    return {
      available: false,
      reason: 'missing-word-field',
    };
  }

  if (templateTargets.length === 0) {
    return {
      available: false,
      reason: 'missing-template-targets',
    };
  }

  if (cardTemplateOrds.length === 0) {
    return {
      available: false,
      reason: 'missing-card-template-ord',
    };
  }

  if (cardTemplateOrds.length > 1) {
    return {
      available: false,
      reason: 'ambiguous-card-template-ord',
    };
  }

  return {
    available: true,
    target: {
      deck,
      model,
      wordField,
      readingField,
      cardTemplateOrd: cardTemplateOrds[0],
      templateTargets,
    },
  };
}
