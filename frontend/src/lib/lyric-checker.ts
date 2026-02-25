import { analyzeLineSyllables } from './syllable-counter';
import type { GenrePreset } from './genre-presets';

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
  pairedContext: string;
}

// Extract rhyme key cross-language (handles Swedish a/a/o)
function extractRhymeKey(word: string): string {
  // Lowercase, strip punctuation but keep a-z and Swedish vowels
  const clean = word.toLowerCase().replace(/[^a-zaaoaa]/g, '');
  if (!clean) return '';

  // Vowels including Swedish
  const vowels = new Set(['a', 'e', 'i', 'o', 'u', 'y', '\u00e5', '\u00e4', '\u00f6']);

  // Find last vowel index
  let lastVowelIdx = -1;
  for (let i = clean.length - 1; i >= 0; i--) {
    if (vowels.has(clean[i])) {
      lastVowelIdx = i;
      break;
    }
  }

  if (lastVowelIdx === -1) return clean; // no vowel - use whole word
  return clean.slice(lastVowelIdx);
}

function getLastWord(line: string): string {
  const words = line.trim().split(/\s+/);
  return words[words.length - 1] || '';
}

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
  // Remove trailing numbers e.g. "Verse 1" -> "verse", "Pre-Chorus 2" -> "pre-chorus"
  return tag.toLowerCase().replace(/\s+\d+$/, '').trim();
}

function checkStructure(sections: ParsedSection[], preset: GenrePreset): StructureCheck[] {
  // Count occurrences of each required tag in preset
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

  // Count actual occurrences in parsed lyrics
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

function analyzeRhymes(section: ParsedSection): RhymeAnalysis {
  const lyricLines = section.lines.filter(l => l.trim() !== '');

  // Compute rhyme keys for each line
  const rhymedLines: RhymedLine[] = [];
  const rhymeKeyToLines: Map<string, number[]> = new Map();

  lyricLines.forEach((text, idx) => {
    const lastWord = getLastWord(text);
    const rhymeKey = extractRhymeKey(lastWord);
    rhymedLines.push({ lineIndex: idx, text, lastWord, rhymeKey, schemeLabel: '' });
    if (!rhymeKeyToLines.has(rhymeKey)) rhymeKeyToLines.set(rhymeKey, []);
    rhymeKeyToLines.get(rhymeKey)!.push(idx);
  });

  // Assign scheme labels - keys appearing 2+ times get letters A, B, C...
  // Keys appearing once get "X"
  const labelMap: Map<string, string> = new Map();
  let nextLabel = 65; // 'A'

  // Assign in first-appearance order
  for (const rl of rhymedLines) {
    if (labelMap.has(rl.rhymeKey)) continue;
    const count = rhymeKeyToLines.get(rl.rhymeKey)?.length ?? 0;
    if (count >= 2) {
      labelMap.set(rl.rhymeKey, String.fromCharCode(nextLabel++));
    } else {
      labelMap.set(rl.rhymeKey, 'X');
    }
  }

  // Apply labels
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

export function analyzeLyrics(lyrics: string, preset: GenrePreset): LyricAnalysisResult {
  const sections = parseSections(lyrics);
  const structureChecks = checkStructure(sections, preset);
  const syllableSummaries = buildSyllableSummaries(lyrics, sections);

  const rhymeAnalyses: RhymeAnalysis[] = sections.map(sec => analyzeRhymes(sec));

  // Collect all orphan lines with absolute line indices
  const allOrphans: Array<{ line: string; lineIndex: number; section: string }> = [];
  for (const ra of rhymeAnalyses) {
    for (const orphan of ra.orphanLines) {
      // Find the section in the original lyrics to compute absolute index
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

  // Build context string for LLM - trimmed lyrics max 800 chars
  const pairedContext = lyrics.slice(0, 800);

  return {
    sectionsFound: sections,
    structureChecks,
    syllableSummaries,
    rhymeAnalyses,
    orphanLines: allOrphans,
    pairedContext,
  };
}
