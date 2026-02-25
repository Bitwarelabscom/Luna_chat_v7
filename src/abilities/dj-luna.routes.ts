import { Router, Request, Response, RequestHandler } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import * as ollamaTertiary from '../llm/providers/ollama-tertiary.provider.js';
import logger from '../utils/logger.js';

const router = Router();

// All routes require authentication
router.use(authenticate as RequestHandler);

interface OrphanLine {
  line: string;
  lineIndex: number;
  section: string;
}

/**
 * POST /api/dj/rhyme-suggestions
 * Uses Qwen 2.5 7B to suggest rhyming alternatives for orphan lines.
 */
router.post('/rhyme-suggestions', async (req: Request, res: Response) => {
  try {
    const { orphanLines, pairedContext, language } = req.body as {
      orphanLines: OrphanLine[];
      pairedContext: string;
      language?: string;
    };

    if (!Array.isArray(orphanLines) || orphanLines.length === 0) {
      res.status(400).json({ error: 'orphanLines array is required' });
      return;
    }

    // Cap at 10 orphan lines
    const lines = orphanLines.slice(0, 10);

    const contextSnippet = typeof pairedContext === 'string'
      ? pairedContext.slice(0, 800)
      : '';

    const langInstruction = language
      ? `Match the language: ${language}.`
      : 'Match the language of the existing lyrics.';

    const linesList = lines
      .map((l, i) => `${i}. (line ${l.lineIndex}, section "${l.section}"): "${l.line}"`)
      .join('\n');

    const userPrompt = `Context (existing lyrics):
${contextSnippet}

${langInstruction}

For each orphan line below, suggest 2-3 alternative ENDINGS (last 1-3 words only) that would rhyme with other lines.
Return ONLY strict JSON, no markdown, no explanation:
{"suggestions":[{"index":0,"alternatives":["word1","two words"]},{"index":1,"alternatives":["alt1","alt2"]}]}

Orphan lines:
${linesList}`;

    const messages = [
      {
        role: 'system' as const,
        content: 'You are a professional songwriter. Suggest rhyming alternatives concisely. Return only valid JSON.',
      },
      {
        role: 'user' as const,
        content: userPrompt,
      },
    ];

    const result = await ollamaTertiary.createCompletion('HoseaDev/qwen2.5-7b-instruct-q4-gguf:latest', messages, {
      temperature: 0.8,
      maxTokens: 8192,
      numCtx: 32768,
    });

    // Strip markdown code fences if present
    let raw = result.content.trim();
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

    let parsed: { suggestions: Array<{ index: number; alternatives: string[] }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('Qwen rhyme suggestions returned invalid JSON', { raw: raw.slice(0, 200) });
      parsed = { suggestions: [] };
    }

    // Map index back to lineIndex
    const suggestions = (parsed.suggestions || []).map(s => ({
      lineIndex: lines[s.index]?.lineIndex ?? s.index,
      suggestions: Array.isArray(s.alternatives) ? s.alternatives : [],
    }));

    res.json({ suggestions });
  } catch (error) {
    logger.error('DJ Luna rhyme suggestions failed', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get rhyme suggestions' });
  }
});

export default router;
