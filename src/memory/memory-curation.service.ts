/**
 * Memory Curation Service
 *
 * Two responsibilities:
 * 1. scoreMessageComplexity() - Pure heuristic, no LLM call (~0ms)
 * 2. curateMemory() - Uses gpt-5-nano to select relevant memories for injection
 */

import { createCompletion } from '../llm/router.js';
import { formatRelativeTime } from './time-utils.js';
import { formatFactsForPrompt, type UserFact } from './facts.service.js';
import type { SimilarMessage } from './embedding.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface ComplexityScore {
  score: number;
  isTrivial: boolean;
}

export interface MemoryCandidates {
  facts: UserFact[];
  similarMessages: SimilarMessage[];
  similarConversations: Array<{
    sessionId: string;
    summary: string;
    topics: string[];
    similarity: number;
    updatedAt: Date;
  }>;
  learnings: string; // Already formatted string from insights service
}

export interface CurationResult {
  skipped: boolean;
  relevantHistory: string;
  conversationContext: string;
  factsPrompt: string;
  learningsPrompt: string;
  reasoning?: string;
}

// ============================================
// Phase 4: Message Complexity Scoring
// ============================================

const PERSONAL_KEYWORDS = new Set([
  'feel', 'feeling', 'remember', 'always', 'never', 'worried', 'afraid',
  'love', 'hate', 'miss', 'wish', 'hope', 'dream', 'believe', 'think about',
  'my life', 'my family', 'growing up', 'childhood', 'relationship',
  'struggle', 'anxious', 'happy', 'sad', 'angry', 'confused', 'grateful',
]);

const TOPIC_DEPTH_KEYWORDS = new Set([
  'project', 'help me', 'advice', 'problem', 'explain', 'how do',
  'what should', 'recommend', 'compare', 'difference between', 'strategy',
  'plan', 'design', 'implement', 'build', 'create', 'debug', 'fix',
  'analyze', 'understand', 'learn about', 'teach me',
]);

/**
 * Score message complexity using pure heuristics (no LLM call).
 * Returns score 0-1 and trivial flag.
 */
export function scoreMessageComplexity(message: string): ComplexityScore {
  if (!message || message.trim().length === 0) {
    return { score: 0, isTrivial: true };
  }

  const lower = message.toLowerCase();
  const words = message.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  let score = 0;

  // Word count factor (up to 0.35)
  // 1-5 words: low, 6-20: medium, 20+: high
  if (wordCount <= 5) {
    score += wordCount * 0.02; // max 0.10
  } else if (wordCount <= 20) {
    score += 0.10 + (wordCount - 5) * 0.0167; // max ~0.35
  } else {
    score += 0.35;
  }

  // Question marks (0.10)
  if (message.includes('?')) {
    score += 0.10;
  }

  // Personal/emotional keywords (0.15)
  for (const keyword of PERSONAL_KEYWORDS) {
    if (lower.includes(keyword)) {
      score += 0.15;
      break;
    }
  }

  // Topic depth keywords (0.15)
  for (const keyword of TOPIC_DEPTH_KEYWORDS) {
    if (lower.includes(keyword)) {
      score += 0.15;
      break;
    }
  }

  // Multi-sentence (0.10)
  const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length >= 2) {
    score += 0.10;
  }

  // Cap at 1.0
  score = Math.min(1.0, score);

  return {
    score,
    isTrivial: score < 0.25,
  };
}

// ============================================
// Phase 5: Memory Curation with gpt-5-nano
// ============================================

const CURATION_SYSTEM_PROMPT = `You are a memory curator for an AI companion named Luna. Given the user's current message, select which memories are relevant to include in Luna's context.

Rules:
- For deep personal/emotional topics: select up to 15 items total
- For casual conversation: select 3-5 items total
- For technical/task-oriented: select 5-10 items total
- Prefer recent memories over old ones when relevance is similar
- Always include facts directly referenced or implied by the current message
- Exclude memories that would clutter context without adding value

Output ONLY a JSON object (no markdown, no explanation outside JSON):
{
  "selectedFacts": [0, 2, 5],
  "selectedMessages": [1, 3],
  "selectedConversations": [0],
  "selectedLearnings": [0, 2],
  "reasoning": "Brief 1-sentence explanation"
}

Use array indices (0-based) to reference items from each candidate list.`;

/**
 * Use gpt-5-nano to curate which memories to inject into Luna's context.
 * On any failure, returns { skipped: true } so caller falls back to direct formatting.
 */
export async function curateMemory(
  currentMessage: string,
  candidates: MemoryCandidates,
  complexityScore: number,
  userId: string,
  _sessionId: string
): Promise<CurationResult> {
  try {
    // Build candidate text for the LLM
    const candidateLines: string[] = [];

    // Facts
    if (candidates.facts.length > 0) {
      candidateLines.push('## FACTS');
      candidates.facts.forEach((f, i) => {
        const relTime = formatRelativeTime(f.lastMentioned);
        const timeParts: string[] = [];
        if (f.mentionCount > 1) timeParts.push(`${f.mentionCount}x`);
        if (relTime) timeParts.push(relTime);
        const timeStr = timeParts.length > 0 ? ` (${timeParts.join(', ')})` : '';
        candidateLines.push(`[${i}] ${f.category}/${f.factKey}: ${f.factValue}${timeStr}`);
      });
    }

    // Similar messages
    if (candidates.similarMessages.length > 0) {
      candidateLines.push('\n## SIMILAR PAST MESSAGES');
      candidates.similarMessages.forEach((m, i) => {
        const relTime = formatRelativeTime(m.createdAt);
        const role = m.role === 'user' ? 'User' : 'Luna';
        const preview = m.content.slice(0, 150) + (m.content.length > 150 ? '...' : '');
        candidateLines.push(`[${i}] [${relTime}] ${role}: ${preview} (sim: ${m.similarity.toFixed(2)})`);
      });
    }

    // Similar conversations
    if (candidates.similarConversations.length > 0) {
      candidateLines.push('\n## SIMILAR PAST CONVERSATIONS');
      candidates.similarConversations.forEach((c, i) => {
        const relTime = formatRelativeTime(c.updatedAt);
        candidateLines.push(`[${i}] [${relTime}] ${c.summary} (topics: ${c.topics.join(', ')})`);
      });
    }

    // Learnings (already formatted, split into lines for indexing)
    const learningLines = candidates.learnings
      ? candidates.learnings.split('\n').filter(l => l.trim().startsWith('-'))
      : [];
    if (learningLines.length > 0) {
      candidateLines.push('\n## LEARNINGS');
      learningLines.forEach((l, i) => {
        candidateLines.push(`[${i}] ${l.trim()}`);
      });
    }

    // If no candidates, skip curation
    if (candidateLines.length === 0) {
      return { skipped: true, relevantHistory: '', conversationContext: '', factsPrompt: '', learningsPrompt: '' };
    }

    const userPrompt = `Current message: "${currentMessage}"
Complexity score: ${complexityScore.toFixed(2)}

Available memories:
${candidateLines.join('\n')}`;

    const response = await createCompletion(
      'openai',
      'gpt-5-nano',
      [
        { role: 'system', content: CURATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        maxTokens: 20000,
        loggingContext: {
          userId,
          sessionId: _sessionId,
          source: 'memory-curation',
          nodeName: 'curate',
        },
      }
    );

    const content = (response.content || '').trim();

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Memory curation returned non-JSON response', { content: content.slice(0, 200) });
      return { skipped: true, relevantHistory: '', conversationContext: '', factsPrompt: '', learningsPrompt: '' };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      selectedFacts?: number[];
      selectedMessages?: number[];
      selectedConversations?: number[];
      selectedLearnings?: number[];
      reasoning?: string;
    };

    // Build curated outputs

    // Curated facts
    let factsPrompt = '';
    if (parsed.selectedFacts && parsed.selectedFacts.length > 0) {
      const selectedFacts = parsed.selectedFacts
        .filter(i => i >= 0 && i < candidates.facts.length)
        .map(i => candidates.facts[i]);
      if (selectedFacts.length > 0) {
        factsPrompt = formatFactsForPrompt(selectedFacts, true);
      }
    }

    // Curated similar messages
    let relevantHistory = '';
    if (parsed.selectedMessages && parsed.selectedMessages.length > 0) {
      const selectedMsgs = parsed.selectedMessages
        .filter(i => i >= 0 && i < candidates.similarMessages.length)
        .map(i => candidates.similarMessages[i]);
      if (selectedMsgs.length > 0) {
        const historyItems = selectedMsgs.map(m => {
          const relTime = formatRelativeTime(m.createdAt);
          const role = m.role === 'user' ? 'User' : 'Luna';
          const timePrefix = relTime ? `[${relTime}] ` : '';
          return `${timePrefix}[${role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? '...' : ''}`;
        });
        relevantHistory = `[Relevant Past Conversations]\n${historyItems.join('\n')}`;
      }
    }

    // Curated similar conversations
    let conversationContext = '';
    if (parsed.selectedConversations && parsed.selectedConversations.length > 0) {
      const selectedConvs = parsed.selectedConversations
        .filter(i => i >= 0 && i < candidates.similarConversations.length)
        .map(i => candidates.similarConversations[i]);
      if (selectedConvs.length > 0) {
        const contextItems = selectedConvs.map(c => {
          const relTime = formatRelativeTime(c.updatedAt);
          const timePrefix = relTime ? `[${relTime}] ` : '';
          return `- ${timePrefix}${c.summary} (Topics: ${c.topics.join(', ')})`;
        });
        conversationContext = `[Related Past Topics]\n${contextItems.join('\n')}`;
      }
    }

    // Curated learnings
    let learningsPrompt = '';
    if (parsed.selectedLearnings && parsed.selectedLearnings.length > 0 && learningLines.length > 0) {
      const selectedLearnings = parsed.selectedLearnings
        .filter(i => i >= 0 && i < learningLines.length)
        .map(i => learningLines[i].trim());
      if (selectedLearnings.length > 0) {
        learningsPrompt = `[Luna's Learnings - Apply these insights to personalize responses]\n${selectedLearnings.join('\n')}`;
      }
    }

    const totalSelected = (parsed.selectedFacts?.length || 0)
      + (parsed.selectedMessages?.length || 0)
      + (parsed.selectedConversations?.length || 0)
      + (parsed.selectedLearnings?.length || 0);

    logger.info('Memory curation complete', {
      userId,
      complexityScore: complexityScore.toFixed(2),
      itemCount: totalSelected,
      reasoning: parsed.reasoning,
    });

    return {
      skipped: false,
      relevantHistory,
      conversationContext,
      factsPrompt,
      learningsPrompt,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    logger.warn('Memory curation failed, falling back to direct formatting', {
      error: (error as Error).message,
      userId,
    });
    return { skipped: true, relevantHistory: '', conversationContext: '', factsPrompt: '', learningsPrompt: '' };
  }
}
