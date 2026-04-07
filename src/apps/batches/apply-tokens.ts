import { JitenToken } from '@shared/jiten/types';
import { Registry } from '../integration/registry';
import { TextHighlighter } from '../text-highlighter/text-highlighter';
import { Fragment } from './types';

export const applyTokens = async (fragments: Fragment[], tokens: JitenToken[]): Promise<void> => {
  await new TextHighlighter(fragments, tokens).apply();
  Registry.statusBar?.recalculateStats();
};
