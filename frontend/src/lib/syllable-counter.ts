/**
 * Client-side syllable counting for lyrics analysis.
 * Uses heuristic rules optimized for English song lyrics.
 */

export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 0;

  // Special one-syllable words that might trip the rules
  if (clean.length <= 2) return 1;

  let count = 0;
  let prev = '';

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const isVowel = /[aeiouy]/.test(ch);
    const prevIsVowel = /[aeiouy]/.test(prev);
    if (isVowel && !prevIsVowel) count++;
    prev = ch;
  }

  // Subtract silent trailing 'e': word ends in consonant+e (but not -le, -ee, -oe, -ye endings)
  if (clean.endsWith('e') && clean.length > 2) {
    const beforeE = clean[clean.length - 2];
    if (!/[aeiou]/.test(beforeE) && beforeE !== 'l') {
      count--;
    }
  }

  // Common suffixes that add syllables back
  if (clean.endsWith('le') && clean.length > 2 && !/[aeiou]/.test(clean[clean.length - 3])) {
    count++;
  }
  if (clean.endsWith('ed') && !clean.endsWith('eed') && clean.length > 2 && !/[aeiouy]/.test(clean[clean.length - 3])) {
    // "-ed" at end usually silent after consonant, already counted
  }
  if (clean.endsWith('es') && clean.length > 2 && !/[aeiou]/.test(clean[clean.length - 3])) {
    // "-es" might be an extra syllable, leave as is
  }

  return Math.max(1, count);
}

export interface LineAnalysis {
  line: string;
  count: number;
  sectionName: string;
  isFlagged: boolean;
  index: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function countLineSyllables(line: string): number {
  const words = line.trim().split(/\s+/);
  return words.reduce((sum, w) => sum + countSyllables(w), 0);
}

export function analyzeLineSyllables(lyrics: string): LineAnalysis[] {
  const lines = lyrics.split('\n');
  const result: LineAnalysis[] = [];

  // Group lines by section
  let currentSection = 'Intro';
  const sectionLines: Map<string, { index: number; count: number }[]> = new Map();

  // First pass: tag each line with section + syllable count
  const lineData: { line: string; section: string; count: number }[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(/^\[(.*?)\]/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      lineData.push({ line, section: currentSection, count: 0 });
    } else if (line.trim() === '') {
      lineData.push({ line, section: currentSection, count: 0 });
    } else {
      const count = countLineSyllables(line);
      lineData.push({ line, section: currentSection, count });
      if (!sectionLines.has(currentSection)) sectionLines.set(currentSection, []);
      sectionLines.get(currentSection)!.push({ index: lineData.length - 1, count });
    }
  }

  // Compute medians per section
  const sectionMedians: Map<string, number> = new Map();
  Array.from(sectionLines.entries()).forEach(([sec, data]) => {
    const nonZero = data.filter((d) => d.count > 0).map((d) => d.count);
    sectionMedians.set(sec, median(nonZero));
  });

  // Second pass: flag outliers
  for (let i = 0; i < lineData.length; i++) {
    const { line, section, count } = lineData[i];
    let isFlagged = false;

    if (count > 0) {
      const med = sectionMedians.get(section) ?? 0;
      if (med > 0) {
        const deviation = Math.abs(count - med) / med;
        if (deviation > 0.35) isFlagged = true;
      }
    }

    result.push({ line, count, sectionName: section, isFlagged, index: i });
  }

  return result;
}
