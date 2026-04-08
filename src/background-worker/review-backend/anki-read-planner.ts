import { DiscoverWordConfigurationEntry } from '@shared/anki/types';
import { JitenCardState, JitenRawVocabulary } from '@shared/jiten/types';
import { LookupConfig, LookupPlan, TermContext } from './anki-review-backend.internal-types';
import { ReviewTermResolution, ReviewTermResolutionMap } from './review-backend.types';

export function getUniqueTermContexts(vocabulary: JitenRawVocabulary[]): Map<string, TermContext> {
  const contexts = new Map<string, TermContext>();

  for (const vocab of vocabulary) {
    const normalisedSpelling = normaliseTextValue(vocab.spelling);
    const normalisedReading = normaliseReadingValue(vocab.reading);
    const termKey = `${normalisedSpelling}\u0000${normalisedReading}`;

    if (contexts.has(termKey)) {
      continue;
    }

    contexts.set(termKey, {
      normalisedSpelling,
      normalisedReading,
      termKey,
      vocabulary: vocab,
    });
  }

  return contexts;
}

export function getLookupConfigs(configs: DiscoverWordConfigurationEntry[]): LookupConfig[] {
  return configs.map(({ config, id }) => ({
    config,
    id,
    deck: config.deck,
    model: config.model,
    readingField: config.readingField,
    templateOrds: config.templateOrds,
    wordField: config.wordField,
  }));
}

export function createLookupPlans(
  termContexts: Map<string, TermContext>,
  lookupConfigs: LookupConfig[],
): LookupPlan[] {
  const plans: LookupPlan[] = [];

  for (const termContext of termContexts.values()) {
    for (const lookupConfig of lookupConfigs) {
      const queryParts = [
        createAnkiQuerySegment('note', lookupConfig.model),
        createAnkiQuerySegment(lookupConfig.wordField, termContext.vocabulary.spelling),
      ];

      if (lookupConfig.deck.length) {
        queryParts.push(createAnkiQuerySegment('deck', lookupConfig.deck));
      }

      plans.push({
        configId: lookupConfig.id,
        query: queryParts.join(' '),
        termKey: termContext.termKey,
      });
    }
  }

  return plans;
}

export function buildResolutionMapFromTerms(
  vocabulary: JitenRawVocabulary[],
  termContexts: Map<string, TermContext>,
  getResolutionForTerm: (termKey: string) => ReviewTermResolution,
): ReviewTermResolutionMap {
  const states: ReviewTermResolutionMap = {};

  for (const vocab of vocabulary) {
    const termKey = getTermKey(vocab);
    const context = termContexts.get(termKey);
    const key = `${vocab.wordId}/${vocab.readingIndex}`;

    states[key] = context
      ? getResolutionForTerm(context.termKey)
      : createUnmappedFallbackResolution();
  }

  return states;
}

export function getUniqueIds(idGroups: Iterable<number[]>): number[] {
  const ids = new Set<number>();

  for (const group of idGroups) {
    for (const id of group) {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

export function getTermKey(vocab: JitenRawVocabulary): string {
  const spelling = normaliseTextValue(vocab.spelling);
  const reading = normaliseReadingValue(vocab.reading);

  return `${spelling}\u0000${reading}`;
}

export function getPlanKey(termKey: string, configId: string): string {
  return `${termKey}\u0000${configId}`;
}

export function createAnkiQuerySegment(field: string, value: string): string {
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

  return `${field}:"${escaped}"`;
}

export function normaliseTextValue(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').trim();
}

export function normaliseReadingValue(value: string): string {
  const flattened = value
    .replace(/[\u4e00-\u9faf\u3005-\u3007]+\[([^\]]+)\]/g, '$1')
    .replace(/[\[\]]/g, '');

  return katakanaToHiragana(normaliseTextValue(flattened));
}

export function katakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60),
  );
}

function createUnmappedFallbackResolution(): ReviewTermResolution {
  return {
    stateTags: [JitenCardState.NEW],
    resolutionStatus: 'resolved',
    mappingOutcome: 'none',
    dueState: 'unknown',
  };
}
