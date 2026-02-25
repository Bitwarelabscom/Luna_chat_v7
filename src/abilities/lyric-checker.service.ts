import type { GenrePreset } from './genre-presets.js';

// ============================================================
// Types
// ============================================================

export interface ParsedSection {
  name: string;
  rawTag: string;
  startLineIndex: number;
  lines: string[];
}

export interface RhymedLine {
  lineIndex: number;
  text: string;
  lastWord: string;
  rhymeKey: string;
  schemeLabel: string;
}

export interface RhymeAnalysis {
  sectionName: string;
  scheme: string;
  lines: RhymedLine[];
  orphanLines: RhymedLine[];
}

export interface SyllableSummary {
  sectionName: string;
  avgSyllables: number;
  outlierCount: number;
  lineCount: number;
}

export interface StructureCheck {
  expectedTag: string;
  found: boolean;
  required: boolean;
}

export interface LyricAnalysisResult {
  sectionsFound: ParsedSection[];
  structureChecks: StructureCheck[];
  syllableSummaries: SyllableSummary[];
  rhymeAnalyses: RhymeAnalysis[];
  orphanLines: Array<{ line: string; lineIndex: number; section: string }>;
  issues: string[];
}

// ============================================================
// Syllable counting (ported from frontend)
// ============================================================

function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 0;
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

  if (clean.endsWith('e') && clean.length > 2) {
    const beforeE = clean[clean.length - 2];
    if (!/[aeiou]/.test(beforeE) && beforeE !== 'l') {
      count--;
    }
  }

  if (clean.endsWith('le') && clean.length > 2 && !/[aeiou]/.test(clean[clean.length - 3])) {
    count++;
  }

  return Math.max(1, count);
}

function countLineSyllables(line: string): number {
  const words = line.trim().split(/\s+/);
  return words.reduce((sum, w) => sum + countSyllables(w), 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface LineAnalysis {
  line: string;
  count: number;
  sectionName: string;
  isFlagged: boolean;
  index: number;
}

function analyzeLineSyllables(lyrics: string): LineAnalysis[] {
  const lines = lyrics.split('\n');
  const result: LineAnalysis[] = [];

  let currentSection = 'Intro';
  const sectionLines: Map<string, { index: number; count: number }[]> = new Map();
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

  const sectionMedians: Map<string, number> = new Map();
  Array.from(sectionLines.entries()).forEach(([sec, data]) => {
    const nonZero = data.filter((d) => d.count > 0).map((d) => d.count);
    sectionMedians.set(sec, median(nonZero));
  });

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

// ============================================================
// Rhyme analysis
// ============================================================

function extractRhymeKey(word: string): string {
  const clean = word.toLowerCase().replace(/[^a-z\u00e5\u00e4\u00f6]/g, '');
  if (!clean) return '';

  const vowels = new Set(['a', 'e', 'i', 'o', 'u', 'y', '\u00e5', '\u00e4', '\u00f6']);

  let lastVowelIdx = -1;
  for (let i = clean.length - 1; i >= 0; i--) {
    if (vowels.has(clean[i])) {
      lastVowelIdx = i;
      break;
    }
  }

  if (lastVowelIdx === -1) return clean;
  return clean.slice(lastVowelIdx);
}

function getLastWord(line: string): string {
  const words = line.trim().split(/\s+/);
  return words[words.length - 1] || '';
}

// ============================================================
// Section parsing
// ============================================================

function parseSections(lyrics: string): ParsedSection[] {
  const lines = lyrics.split('\n');
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tagMatch = line.match(/^\[([^\]]+)\]/);

    if (tagMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = {
        name: tagMatch[1],
        rawTag: line,
        startLineIndex: i,
        lines: [],
      };
    } else if (currentSection) {
      currentSection.lines.push(line);
    }
  }

  if (currentSection) sections.push(currentSection);
  return sections;
}

function normalizeTag(tag: string): string {
  return tag.toLowerCase().replace(/\s+\d+$/, '').trim();
}

// ============================================================
// Structure checking
// ============================================================

function checkStructure(sections: ParsedSection[], preset: GenrePreset): StructureCheck[] {
  const expectedCounts: Map<string, { count: number; required: boolean }> = new Map();
  for (const s of preset.structure) {
    const key = s.tag;
    const existing = expectedCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      expectedCounts.set(key, { count: 1, required: s.required });
    }
  }

  const actualCounts: Map<string, number> = new Map();
  for (const sec of sections) {
    const norm = normalizeTag(sec.name);
    actualCounts.set(norm, (actualCounts.get(norm) ?? 0) + 1);
  }

  const checks: StructureCheck[] = [];
  Array.from(expectedCounts.entries()).forEach(([tag, { count, required }]) => {
    const actual = actualCounts.get(tag) ?? 0;
    checks.push({
      expectedTag: tag,
      found: actual >= count,
      required,
    });
  });

  return checks;
}

// ============================================================
// Rhyme analysis per section
// ============================================================

function analyzeRhymes(section: ParsedSection): RhymeAnalysis {
  const lyricLines = section.lines.filter(l => l.trim() !== '');

  const rhymedLines: RhymedLine[] = [];
  const rhymeKeyToLines: Map<string, number[]> = new Map();

  lyricLines.forEach((text, idx) => {
    const lastWord = getLastWord(text);
    const rhymeKey = extractRhymeKey(lastWord);
    rhymedLines.push({ lineIndex: idx, text, lastWord, rhymeKey, schemeLabel: '' });
    if (!rhymeKeyToLines.has(rhymeKey)) rhymeKeyToLines.set(rhymeKey, []);
    rhymeKeyToLines.get(rhymeKey)!.push(idx);
  });

  const labelMap: Map<string, string> = new Map();
  let nextLabel = 65;

  for (const rl of rhymedLines) {
    if (labelMap.has(rl.rhymeKey)) continue;
    const count = rhymeKeyToLines.get(rl.rhymeKey)?.length ?? 0;
    if (count >= 2) {
      labelMap.set(rl.rhymeKey, String.fromCharCode(nextLabel++));
    } else {
      labelMap.set(rl.rhymeKey, 'X');
    }
  }

  for (const rl of rhymedLines) {
    rl.schemeLabel = labelMap.get(rl.rhymeKey) ?? 'X';
  }

  const scheme = rhymedLines.map(rl => rl.schemeLabel).join('');
  const orphanLines = rhymedLines.filter(rl => rl.schemeLabel === 'X');

  return {
    sectionName: section.name,
    scheme,
    lines: rhymedLines,
    orphanLines,
  };
}

// ============================================================
// Syllable summaries
// ============================================================

function buildSyllableSummaries(lyrics: string, sections: ParsedSection[]): SyllableSummary[] {
  const lineAnalysis = analyzeLineSyllables(lyrics);
  const summaries: SyllableSummary[] = [];

  for (const section of sections) {
    const sectionLineAnalysis = lineAnalysis.filter(
      la => la.sectionName === section.name && la.count > 0
    );
    if (sectionLineAnalysis.length === 0) continue;

    const total = sectionLineAnalysis.reduce((sum, la) => sum + la.count, 0);
    const avg = total / sectionLineAnalysis.length;
    const outlierCount = sectionLineAnalysis.filter(la => la.isFlagged).length;

    summaries.push({
      sectionName: section.name,
      avgSyllables: Math.round(avg * 10) / 10,
      outlierCount,
      lineCount: sectionLineAnalysis.length,
    });
  }

  return summaries;
}

// ============================================================
// Main analysis function
// ============================================================

export function analyzeLyrics(lyrics: string, preset: GenrePreset): LyricAnalysisResult {
  const sections = parseSections(lyrics);
  const structureChecks = checkStructure(sections, preset);
  const syllableSummaries = buildSyllableSummaries(lyrics, sections);
  const rhymeAnalyses: RhymeAnalysis[] = sections.map(sec => analyzeRhymes(sec));

  const allOrphans: Array<{ line: string; lineIndex: number; section: string }> = [];
  for (const ra of rhymeAnalyses) {
    for (const orphan of ra.orphanLines) {
      const section = sections.find(s => s.name === ra.sectionName);
      if (!section) continue;
      const lyricLines = section.lines.filter(l => l.trim() !== '');
      const absoluteIndex = section.startLineIndex + section.lines.indexOf(lyricLines[orphan.lineIndex]) + 1;
      allOrphans.push({
        line: orphan.text,
        lineIndex: absoluteIndex,
        section: ra.sectionName,
      });
    }
  }

  // Build machine-readable issues list for the pipeline
  const issues: string[] = [];

  // Structure issues
  const missingRequired = structureChecks.filter(c => c.required && !c.found);
  for (const check of missingRequired) {
    issues.push(`Missing required section: [${check.expectedTag}]`);
  }

  // Syllable outlier issues
  for (const summary of syllableSummaries) {
    if (summary.outlierCount > 0) {
      issues.push(`${summary.outlierCount} syllable outlier(s) in [${summary.sectionName}] (avg: ${summary.avgSyllables})`);
    }
  }

  // Rhyme orphan issues (only if > 30% lines are orphans in a section)
  for (const ra of rhymeAnalyses) {
    if (ra.lines.length > 0 && ra.orphanLines.length / ra.lines.length > 0.3) {
      issues.push(`Weak rhyme scheme in [${ra.sectionName}]: ${ra.orphanLines.length}/${ra.lines.length} lines unrhymed (scheme: ${ra.scheme})`);
    }
  }

  return {
    sectionsFound: sections,
    structureChecks,
    syllableSummaries,
    rhymeAnalyses,
    orphanLines: allOrphans,
    issues,
  };
}

/**
 * Quick pass/fail check for the pipeline.
 * Returns true if there are no blocking issues (missing required sections).
 */
export function lyricsPassCheck(lyrics: string, preset: GenrePreset): { pass: boolean; issues: string[] } {
  const result = analyzeLyrics(lyrics, preset);
  // Only required structure checks are blocking
  const blocking = result.issues.filter(i => i.startsWith('Missing required section'));
  return { pass: blocking.length === 0, issues: result.issues };
}
