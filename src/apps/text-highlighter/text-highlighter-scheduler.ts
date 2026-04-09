import { Fragment } from '../batches/types';

export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function processInChunks<TKey>(
  chunkSize: number,
  items: Map<TKey, Fragment[]>,
  processor: (item: TKey, fragments: Fragment[]) => void,
): Promise<void> {
  const entries = [...items.entries()];
  let processed = 0;

  for (const [item, fragments] of entries) {
    processor(item, fragments);
    processed++;

    if (processed % chunkSize === 0 && processed < entries.length) {
      await yieldToMainThread();
    }
  }
}
