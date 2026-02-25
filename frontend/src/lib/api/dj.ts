import { api } from './core';

export interface OrphanLine {
  line: string;
  lineIndex: number;
  section: string;
}

export interface RhymeSuggestion {
  lineIndex: number;
  suggestions: string[];
}

export async function getRhymeSuggestions(
  orphanLines: OrphanLine[],
  pairedContext: string,
  language?: string
): Promise<{ suggestions: RhymeSuggestion[] }> {
  return api('/api/dj/rhyme-suggestions', {
    method: 'POST',
    body: { orphanLines, pairedContext, language },
  });
}
