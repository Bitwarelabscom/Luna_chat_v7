/**
 * Knowledge Verifier Service
 * Verifies research findings using configurable background LLM
 */

import { query } from '../db/postgres.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import logger from '../utils/logger.js';
import type { ResearchFindings } from './research-coordinator.service.js';

export interface VerificationResult {
  passed: boolean;
  confidence: number; // 0-1
  reasoning: string;
  internalConsistency: boolean;
  plausibility: boolean;
  sourceAgreement: boolean;
}

/**
 * Verify research findings for accuracy and consistency
 */
export async function verifyFindings(
  userId: string,
  topic: string,
  findings: ResearchFindings,
  trustScores: number[]
): Promise<VerificationResult> {
  try {
    // Check if we have enough trusted sources
    if (findings.sources.length === 0) {
      return {
        passed: false,
        confidence: 0,
        reasoning: 'No trusted sources available for verification.',
        internalConsistency: false,
        plausibility: false,
        sourceAgreement: false,
      };
    }

    // Calculate average trust score (handle empty array to avoid NaN)
    const avgTrustScore = trustScores.length > 0
      ? trustScores.reduce((sum, score) => sum + score, 0) / trustScores.length
      : 0.85; // Default trust if no scores but sources were found (optimistic)

    if (avgTrustScore < 0.8) {
      return {
        passed: false,
        confidence: 0,
        reasoning: `Average source trust score (${avgTrustScore.toFixed(2)}) below threshold (0.8).`,
        internalConsistency: false,
        plausibility: false,
        sourceAgreement: false,
      };
    }

    const verificationResult = await verifyWithModel(userId, topic, findings, trustScores);

    // Store verification result
    return verificationResult;
  } catch (error) {
    logger.error('Error verifying findings', { error, topic });
    throw error;
  }
}

async function verifyWithModel(
  userId: string,
  topic: string,
  findings: ResearchFindings,
  trustScores: number[]
): Promise<VerificationResult> {
  try {
    const avgTrustScore = trustScores.length > 0
      ? trustScores.reduce((sum, score) => sum + score, 0) / trustScores.length
      : 0.85;

    const prompt = `Verify the following researched information for consistency and plausibility:

Research Topic: ${topic}
Source Trust Scores: ${trustScores.length > 0 ? trustScores.map((s) => s.toFixed(2)).join(', ') : 'N/A'} (avg: ${avgTrustScore.toFixed(2)})
Number of Sources: ${findings.sources.length}

Key Findings:
${findings.keyFacts.map((fact, i) => `${i + 1}. ${fact}`).join('\n')}

Summary:
${findings.summary}

Analyze:
1. Internal consistency - do the findings contradict themselves?
2. Plausibility - does this align with known facts?
3. Source agreement - do multiple sources confirm the same information?
4. Confidence assessment (0-1)

Should this be embedded into memory? (yes/no + reasoning)

Output valid JSON only:
{
  "internalConsistency": true,
  "plausibility": true,
  "sourceAgreement": true,
  "confidence": 0.85,
  "passed": true,
  "reasoning": "Brief explanation of verification decision"
}`;

    const response = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'knowledge_verification',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 1000,
      loggingContext: {
        userId,
        source: 'autonomous_research',
        nodeName: 'knowledge_verification',
      },
    });

    const responseText = response.content.trim();

    // Parse JSON response
    const jsonText = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const result = JSON.parse(jsonText);

    logger.info('Verification completed', {
      topic,
      passed: result.passed,
      confidence: result.confidence,
    });

    return {
      passed: result.passed || false,
      confidence: result.confidence || 0,
      reasoning: result.reasoning || 'No reasoning provided.',
      internalConsistency: result.internalConsistency || false,
      plausibility: result.plausibility || false,
      sourceAgreement: result.sourceAgreement || false,
    };
  } catch (error) {
    logger.error('Error in model verification', { error });

    // Fallback verification based on simple heuristics
    const sourceCount = findings.sources.length;
    const avgTrustScore = trustScores.length > 0
      ? trustScores.reduce((sum, score) => sum + score, 0) / trustScores.length
      : 0.85;

    const passed = sourceCount >= 2 && avgTrustScore >= 0.8 && findings.confidence >= 0.6;

    return {
      passed,
      confidence: passed ? 0.7 : 0.3,
      reasoning: `Fallback verification: ${sourceCount} sources, avg trust ${avgTrustScore.toFixed(2)}, research confidence ${findings.confidence.toFixed(2)}`,
      internalConsistency: sourceCount >= 2,
      plausibility: avgTrustScore >= 0.8,
      sourceAgreement: sourceCount >= 2,
    };
  }
}

/**
 * Store verification result in database
 */
export async function storeVerificationResult(
  sessionId: number,
  result: VerificationResult
): Promise<void> {
  await query(
    `UPDATE autonomous_research_sessions
     SET verification_result = $1
     WHERE id = $2`,
    [JSON.stringify(result), sessionId]
  );

  logger.info('Verification result stored', { sessionId, passed: result.passed });
}
