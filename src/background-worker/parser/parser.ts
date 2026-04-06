import { createReviewMetadata } from '@shared/jiten/create-review-metadata';
import { mapReviewStates } from '@shared/jiten/map-review-states';
import { parse } from '@shared/jiten/parse';
import {
  JitenCard,
  JitenCardState,
  JitenRawVocabulary,
  JitenRuby,
  JitenToken,
} from '@shared/jiten/types';
import { ReviewBackendSelector } from '../review-backend/review-backend-selector';
import { ReviewBackendStatus } from '../review-backend/review-backend-selector.types';
import { ReviewBackend, ReviewTermStateMap } from '../review-backend/review-backend.types';
import { Batch } from './parser.types';
import { getPitchClass } from './pitch-accent-utils';

export class Parser {
  constructor(
    private readonly batch: Batch,
    private readonly reviewBackendSelector: ReviewBackendSelector,
  ) {}

  public async parse(): Promise<void> {
    const paragraphs = this.batch.strings;
    const { tokens, vocabulary } = await parse(paragraphs);
    const backendStatus = await this.reviewBackendSelector.getStatus();
    const activeBackend = await this.reviewBackendSelector.getActiveBackend();
    const { effectiveBackendStatus, parseReviewStates, effectiveBackend } =
      await this.getParseReviewStates(vocabulary, backendStatus, activeBackend);
    const cards = this.vocabToCard(
      vocabulary,
      effectiveBackendStatus,
      parseReviewStates,
      effectiveBackend,
    );
    const parsedTokens = this.parseTokens(tokens, cards, vocabulary);

    this.addSentenceInfo(paragraphs, parsedTokens);

    for (const [i, handle] of this.batch.handles.entries()) {
      handle.resolve(parsedTokens[i]);
    }
  }

  private extractRubiesFromAnnotated(input: string): JitenRuby[] {
    const rubies: JitenRuby[] = [];

    // Group 1: Prefix (any text before the target, including newlines)
    // Group 2: The Base (Kanji and Iteration marks like 々)
    // Group 3: The Ruby (inside brackets)
    const regex = /((?:.|\n)*?)([\u4e00-\u9faf\u3005-\u3007]+)\[([^\]]+)\]/g;

    let match: RegExpExecArray | null;
    let currentOffset = 0; // This tracks the position in the CLEAN (displayed) string

    while ((match = regex.exec(input)) !== null) {
      const prefix = match[1]; // e.g., "もう" in "もう一度"
      const base = match[2]; // e.g., "一度"
      const ruby = match[3]; // e.g., "いちど"

      // 1. Advance offset past the prefix (plain text that has no ruby)
      currentOffset += prefix.length;

      // 2. Mark the ruby position
      const start = currentOffset;
      const length = base.length;
      const end = start + length;

      rubies.push({
        text: ruby,
        start,
        end,
        length,
      });

      // 3. Advance offset past the base (the text covered by ruby)
      currentOffset += length;
    }

    return rubies;
  }

  private vocabToCard(
    vocabulary: JitenRawVocabulary[],
    backendStatus: ReviewBackendStatus,
    parseReviewStates: ReviewTermStateMap,
    activeBackend: ReviewBackend,
  ): JitenCard[] {
    return vocabulary.map((vocab) => {
      const {
        wordId,
        readingIndex,
        spelling,
        reading,
        frequencyRank,
        partsOfSpeech,
        meaningsChunks,
        meaningsPartOfSpeech,
        knownState,
        pitchAccents,
      } = vocab;

      const cardState = this.enrichCardReviewState(
        vocab,
        knownState,
        backendStatus,
        parseReviewStates,
      );
      const reviewMetadata = createReviewMetadata({
        backend: backendStatus.activeBackend,
        wordId,
        readingIndex,
        stateTags: cardState,
        freshness: 'stale',
        actionsAvailable: activeBackend.getCapabilities().supportsDeckActions,
      });

      return {
        wordId,
        readingIndex,
        spelling,
        reading,
        frequencyRank,
        partsOfSpeech: Array.isArray(partsOfSpeech) ? partsOfSpeech : [partsOfSpeech],
        meanings: meaningsChunks.map((glosses, i) => ({
          glosses,
          partsOfSpeech: meaningsPartOfSpeech[i],
        })),
        cardState,
        reviewBackend: backendStatus.activeBackend,
        reviewMetadata,
        pitchAccents: pitchAccents ?? [],
        wordWithReading: null,
      };
    });
  }

  private enrichCardReviewState(
    vocabulary: JitenRawVocabulary,
    knownState: number[],
    backendStatus: ReviewBackendStatus,
    parseReviewStates: ReviewTermStateMap,
  ): JitenCardState[] {
    const key = `${vocabulary.wordId}/${vocabulary.readingIndex}`;

    if (parseReviewStates[key]) {
      return parseReviewStates[key];
    }

    const fallbackState = this.getReviewStateFallback(backendStatus);

    return mapReviewStates(knownState, fallbackState);
  }

  private getReviewStateFallback(backendStatus: ReviewBackendStatus): JitenCardState {
    switch (backendStatus.activeBackend) {
      case 'anki':
        return JitenCardState.NEW;
      case 'jiten':
      default:
        return JitenCardState.MATURE;
    }
  }

  private async getParseReviewStates(
    vocabulary: JitenRawVocabulary[],
    backendStatus: ReviewBackendStatus,
    activeBackend: ReviewBackend,
  ): Promise<{
    effectiveBackendStatus: ReviewBackendStatus;
    parseReviewStates: ReviewTermStateMap;
    effectiveBackend: ReviewBackend;
  }> {
    try {
      const parseReviewStates = await activeBackend.getParseReviewStates(vocabulary);

      return {
        effectiveBackendStatus: backendStatus,
        parseReviewStates,
        effectiveBackend: activeBackend,
      };
    } catch {
      const jitenBackend = this.reviewBackendSelector.getBackend('jiten');
      const jitenParseStates = jitenBackend
        ? await jitenBackend.getParseReviewStates(vocabulary)
        : {};

      return {
        effectiveBackendStatus: {
          ...backendStatus,
          activeBackend: 'jiten',
          availability: {
            ...backendStatus.availability,
            anki: 'unavailable',
          },
        },
        parseReviewStates: jitenParseStates,
        effectiveBackend: jitenBackend ?? activeBackend,
      };
    }
  }

  private parseTokens(
    tokens: JitenToken[][],
    cards: JitenCard[],
    vocabulary: JitenRawVocabulary[],
  ): JitenToken[][] {
    return tokens.map((group) => {
      let lastPitchClass = '';

      return group.map((token) => {
        const vocabEntry = vocabulary.find((v) => {
          return v.wordId === token.wordId && v.readingIndex === token.readingIndex;
        });

        const card = cards.find(
          (c) => c.wordId === token.wordId && c.readingIndex === token.readingIndex,
        )!;

        const isParticle = card.partsOfSpeech.includes('prt');
        const pitchClass = isParticle ? '' : getPitchClass(card.pitchAccents, card.reading);

        lastPitchClass = pitchClass || lastPitchClass;

        const rubies = vocabEntry?.reading
          ? this.extractRubiesFromAnnotated(vocabEntry.reading).map((ruby) => ({
              ...ruby,
              start: token.start + ruby.start,
              end: token.start + ruby.start + ruby.length,
            }))
          : [];

        const updated: JitenToken = {
          ...token,
          card,
          pitchClass: lastPitchClass,
          rubies,
        };

        if (card) {
          this.assignWordWithReadingJiten(updated, card);
        }

        return updated;
      });
    });
  }

  private assignWordWithReadingJiten(token: JitenToken, card: JitenCard): void {
    const ruby = token.rubies;
    const offset = token.start;
    const kanji = card.spelling;

    if (!ruby.length) {
      return;
    }

    const word = kanji.split('');

    for (let i = ruby.length - 1; i >= 0; i--) {
      const { text, start, length } = ruby[i];

      word.splice(start - offset + length, 0, `[${text}]`);
    }

    card.wordWithReading = word.join('');
  }

  private addSentenceInfo(paragraphs: string[], tokens: JitenToken[][]): void {
    paragraphs.forEach((paragraph, i) => {
      const tokenData = tokens[i];
      const sentences = this.splitJapaneseTextIntoSentences(paragraph);

      if (sentences.length === 1) {
        tokenData.forEach((token) => {
          token.sentence = sentences[0];
        });

        return;
      }

      let offset = 0;

      for (let s = 0; s < sentences.length; s++) {
        const sentence = sentences[s];
        const compareSentence = sentence.replace(/(^[「『])|([。！？」』]$)/g, '');
        const positionInParagraphs = paragraph.substring(offset).indexOf(compareSentence);

        if (positionInParagraphs === -1) {
          continue;
        }

        const sentenceStart = offset + positionInParagraphs;

        const nextCompareSentence = sentences[s + 1]?.replace(/(^[「『])|([。！？」』]$)/g, '');
        const nextPosition = nextCompareSentence
          ? paragraph.indexOf(nextCompareSentence, sentenceStart + compareSentence.length)
          : -1;
        const sentenceEnd = nextPosition !== -1 ? nextPosition : paragraph.length;

        for (const token of tokenData) {
          if (token.start >= sentenceStart && token.end <= sentenceEnd) {
            token.sentence = sentence;
          }
        }

        offset = sentenceStart + compareSentence.length;
      }
    });
  }

  private splitJapaneseTextIntoSentences(text: string): string[] {
    // Regular expression to match sentence-ending punctuation marks and quotation marks
    const sentenceEndRegex = /.*?[。！？」』](?=\s?|$)|「.*?」|『.*?』/g;
    const sentences = text.match(sentenceEndRegex) || [];

    return sentences.length
      ? sentences
          .map((sentence) => sentence.trim())
          .filter(Boolean)
          .filter((sentence) => !/^[」』]$/.exec(sentence))
          .map((sentence) => {
            // If the sentence is a quotation, return it as is
            if (/「.*?」|『.*?』/.exec(sentence)) {
              return sentence;
            }

            // If a quotation contained multiple sentences, remove the quotation marks
            const trimmed = sentence.replace(/(^「|『)|(」|』$)/, '');

            // Add a period at the end of the sentence if it doesn't already have a sentence-ending punctuation mark
            return /[。！？]$/.exec(trimmed) ? trimmed : `${trimmed}。`;
          })
      : [text];
  }
}
