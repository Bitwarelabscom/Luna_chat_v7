/**
 * Autonomous Learning Orchestrator
 * Main orchestrator for the knowledge evolution system
 */

import { query } from '../db/postgres.js';
import * as sessionAnalyzer from './session-analyzer.service.js';
import * as researchCoordinator from './research-coordinator.service.js';
import * as knowledgeVerifier from './knowledge-verifier.service.js';
import * as knowledgeEmbedder from './knowledge-embedder.service.js';
import * as friendService from './friend.service.js';
import logger from '../utils/logger.js';

const PRIMARY_PRIORITY_THRESHOLD = 0.7;
const MAX_GAPS_PER_RUN = 5;
const LOW_PRIORITY_FALLBACK_MIN_PRIORITY = 0.5;
const LOW_PRIORITY_FALLBACK_MAX_PER_RUN = 2;

export interface OrchestrationResult {
  userId: string;
  gapsIdentified: number;
  gapsResearched: number;
  gapsVerified: number;
  knowledgeEmbedded: number;
  friendDiscussions: number;
  manualApproval: number;
  errors: string[];
}

/**
 * Main orchestrator function - runs the entire autonomous learning pipeline
 * This is called by the daily background job
 */
export async function orchestrateAutonomousLearning(
  userId: string
): Promise<OrchestrationResult> {
  const result: OrchestrationResult = {
    userId,
    gapsIdentified: 0,
    gapsResearched: 0,
    gapsVerified: 0,
    knowledgeEmbedded: 0,
    friendDiscussions: 0,
    manualApproval: 0,
    errors: [],
  };

  try {
    logger.info('Starting autonomous learning orchestration', { userId });

    // Log analysis start
    await logActivity(userId, 'analysis', { stage: 'start' }, true);

    // Step 1: Analyze sessions for knowledge gaps (last 90 days)
    const analysisResult = await sessionAnalyzer.analyzeSessionsForGaps(userId, 90);

    if (analysisResult.gaps.length === 0) {
      logger.info('No knowledge gaps identified', { userId });
      await logActivity(
        userId,
        'analysis',
        { stage: 'complete', gapsFound: 0 },
        true
      );
      return result;
    }

    result.gapsIdentified = analysisResult.gaps.length;

    // Store gaps in database
    await sessionAnalyzer.storeKnowledgeGaps(userId, analysisResult.gaps);

    await logActivity(
      userId,
      'analysis',
      {
        stage: 'complete',
        gapsFound: result.gapsIdentified,
        sessionsAnalyzed: analysisResult.sessionsAnalyzed,
      },
      true
    );

    // Step 2: Select pending gaps for this run.
    // Prefer high-priority items; if none are available, drain a small low-priority batch.
    const pendingGaps = await sessionAnalyzer.getPendingGaps(userId, MAX_GAPS_PER_RUN);
    const highPriorityGaps = pendingGaps.filter(
      (gap) => gap.priority >= PRIMARY_PRIORITY_THRESHOLD
    );

    let gapsToProcess = highPriorityGaps;
    let selectionMode: 'high_priority' | 'low_priority_fallback' = 'high_priority';

    if (gapsToProcess.length === 0 && pendingGaps.length > 0) {
      const lowPriorityFallback = pendingGaps
        .filter((gap) => gap.priority >= LOW_PRIORITY_FALLBACK_MIN_PRIORITY)
        .slice(0, LOW_PRIORITY_FALLBACK_MAX_PER_RUN);

      if (lowPriorityFallback.length > 0) {
        gapsToProcess = lowPriorityFallback;
        selectionMode = 'low_priority_fallback';
      }
    }

    logger.info('Selected pending gaps for processing', {
      userId,
      total: pendingGaps.length,
      highPriority: highPriorityGaps.length,
      selected: gapsToProcess.length,
      selectionMode,
      highPriorityThreshold: PRIMARY_PRIORITY_THRESHOLD,
      lowPriorityFallbackMin: LOW_PRIORITY_FALLBACK_MIN_PRIORITY,
      lowPriorityFallbackMax: LOW_PRIORITY_FALLBACK_MAX_PER_RUN,
    });

    if (gapsToProcess.length === 0) {
      return result;
    }

    // Step 3: Research each selected gap
    for (const gap of gapsToProcess) {
      try {
        // PREVENT REDUNDANCY: Check if a similar gap (semantic similarity > 0.85) was already embedded or verified
        if (gap.embedding) {
          const vectorString = JSON.stringify(gap.embedding);
          const similarCompletedGaps = await query<any>(
            `SELECT id, gap_description, status, 1 - (embedding <=> $1) as similarity
             FROM knowledge_gaps
             WHERE user_id = $2 
               AND status IN ('embedded', 'verified')
               AND id != $3
               AND embedding IS NOT NULL
               AND 1 - (embedding <=> $1) > 0.85
             LIMIT 1`,
            [vectorString, userId, gap.id]
          );

          if (similarCompletedGaps.length > 0) {
            logger.info('Skipping research for knowledge gap (already learned similar topic)', {
              userId,
              gapId: gap.id,
              newTopic: gap.gapDescription,
              existingTopic: similarCompletedGaps[0].gap_description,
              similarity: similarCompletedGaps[0].similarity
            });
            
            // Mark as embedded (since we already have similar info)
            await sessionAnalyzer.updateGapStatus(gap.id, 'embedded', 'Duplicate of ' + similarCompletedGaps[0].gap_description);
            continue;
          }
        }

        // Update status to researching
        await sessionAnalyzer.updateGapStatus(gap.id, 'researching');

        // Conduct research
        const { sessionId, findings } = await researchCoordinator.conductResearch(
          userId,
          gap.id,
          gap.gapDescription,
          gap.suggestedQueries
        );

        result.gapsResearched++;

        await logActivity(
          userId,
          'research',
          {
            gapId: gap.id,
            topic: gap.gapDescription,
            sessionId,
            sourcesFound: findings.sources.length,
          },
          true
        );

        // Step 4: Verify findings
        const trustScores = findings.sources
          .map((s) => s.trustScore)
          .filter((s): s is number => s !== null);

        const verificationResult = await knowledgeVerifier.verifyFindings(
          userId,
          gap.gapDescription,
          findings,
          trustScores
        );

        await knowledgeVerifier.storeVerificationResult(sessionId, verificationResult);

        await logActivity(
          userId,
          'verification',
          {
            gapId: gap.id,
            sessionId,
            passed: verificationResult.passed,
            confidence: verificationResult.confidence,
          },
          verificationResult.passed
        );

        if (!verificationResult.passed) {
          // Mark as rejected and flag for manual approval if confidence is decent (>= 0.3)
          const needsManualApproval = verificationResult.confidence >= 0.3;
          await sessionAnalyzer.updateGapStatus(
            gap.id,
            'rejected',
            verificationResult.reasoning
          );
          
          if (needsManualApproval) {
            await query(
              `UPDATE knowledge_gaps SET manual_approval_required = true WHERE id = $1`,
              [gap.id]
            );
            result.manualApproval++;
          }

          logger.info('Knowledge gap rejected after verification', {
            userId,
            gapId: gap.id,
            confidence: verificationResult.confidence,
            manualApprovalSet: needsManualApproval,
            reason: verificationResult.reasoning,
          });
          continue;
        }

        result.gapsVerified++;
        await sessionAnalyzer.updateGapStatus(gap.id, 'verified');

        // Step 5: Friend discussion (optional - adds insights)
        try {
          const discussion = await friendService.startFriendDiscussion(
            null, // No session required
            userId,
            gap.gapDescription,
            `Research findings: ${findings.summary}`,
            'random', // Random trigger type
            3, // 3 rounds
            undefined // Auto-select friend
          );

          result.friendDiscussions++;

          // Link discussion to research session
          await query(
            `UPDATE autonomous_research_sessions
             SET friend_discussion_id = $1
             WHERE id = $2`,
            [discussion.id, sessionId]
          );

          logger.info('Friend discussion completed', {
            userId,
            gapId: gap.id,
            discussionId: discussion.id,
          });
        } catch (error) {
          logger.warn('Friend discussion failed (non-critical)', {
            error,
            gapId: gap.id,
          });
        }

        // Step 6: Embed verified knowledge into MemoryCore
        const avgTrustScore =
          trustScores.reduce((sum, s) => sum + s, 0) / trustScores.length;

        const embeddingResult = await knowledgeEmbedder.embedKnowledge(
          userId,
          sessionId,
          gap.gapDescription,
          findings,
          avgTrustScore
        );

        if (embeddingResult.success) {
          result.knowledgeEmbedded++;
          await sessionAnalyzer.updateGapStatus(gap.id, 'embedded');

          // Create notification
          await knowledgeEmbedder.createLearningNotification(
            userId,
            gap.gapDescription,
            sessionId
          );

          logger.info('Knowledge successfully embedded', {
            userId,
            gapId: gap.id,
            sessionId,
            interactionId: embeddingResult.interactionId,
          });
        } else {
          await sessionAnalyzer.updateGapStatus(
            gap.id,
            'failed',
            embeddingResult.error
          );
          result.errors.push(
            `Failed to embed gap ${gap.id}: ${embeddingResult.error}`
          );
        }
      } catch (error) {
        logger.error('Error processing knowledge gap', {
          error,
          userId,
          gapId: gap.id,
        });

        await sessionAnalyzer.updateGapStatus(
          gap.id,
          'failed',
          (error as Error).message
        );

        result.errors.push(
          `Gap ${gap.id}: ${(error as Error).message}`
        );
      }
    }

    logger.info('Autonomous learning orchestration complete', result);

    return result;
  } catch (error) {
    logger.error('Fatal error in autonomous learning orchestration', {
      error,
      userId,
    });

    await logActivity(
      userId,
      'analysis',
      { error: (error as Error).message },
      false,
      (error as Error).message
    );

    result.errors.push((error as Error).message);
    return result;
  }
}

/**
 * Log activity to autonomous_learning_log table
 */
async function logActivity(
  userId: string,
  actionType: string,
  details: any,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO autonomous_learning_log (
         user_id,
         action_type,
         details,
         success,
         error_message
       ) VALUES ($1, $2, $3, $4, $5)`,
      [userId, actionType, JSON.stringify(details), success, errorMessage || null]
    );
  } catch (error) {
    logger.error('Failed to log activity', { error, userId, actionType });
  }
}

/**
 * Get all users eligible for autonomous learning
 * (could be filtered by config/preferences in the future)
 */
export async function getEligibleUsers(): Promise<string[]> {
  try {
    // Get active users who have autonomous learning enabled in their config
    const rows = await query<{id: string}>(
      `SELECT u.id 
       FROM users u
       JOIN autonomous_config ac ON u.id = ac.user_id
       WHERE u.is_active = true AND ac.learning_enabled = true`
    );

    return rows.map((row) => row.id);
  } catch (error) {
    logger.error('Error getting eligible users', { error });
    return [];
  }
}

/**
 * Run autonomous learning for all eligible users
 * This is the entry point for the daily background job
 */
export async function runAutonomousLearningForAllUsers(): Promise<{
  usersProcessed: number;
  totalGapsIdentified: number;
  totalKnowledgeEmbedded: number;
  errors: number;
}> {
  const summary = {
    usersProcessed: 0,
    totalGapsIdentified: 0,
    totalKnowledgeEmbedded: 0,
    errors: 0,
  };

  try {
    const users = await getEligibleUsers();

    logger.info('Running autonomous learning for all users', {
      userCount: users.length,
    });

    for (const userId of users) {
      try {
        const result = await orchestrateAutonomousLearning(userId);

        summary.usersProcessed++;
        summary.totalGapsIdentified += result.gapsIdentified;
        summary.totalKnowledgeEmbedded += result.knowledgeEmbedded;
        summary.errors += result.errors.length;
      } catch (error) {
        logger.error('Error in autonomous learning for user', {
          error,
          userId,
        });
        summary.errors++;
      }
    }

    logger.info('Autonomous learning complete for all users', summary);

    return summary;
  } catch (error) {
    logger.error('Fatal error in autonomous learning job', { error });
    throw error;
  }
}

/**
 * Embed a manually approved knowledge gap
 * Called after user manually approves a rejected gap
 */
export async function embedApprovedGap(gapId: number, userId: string): Promise<void> {
  try {
    logger.info('Embedding manually approved gap', { gapId, userId });

    // Fetch gap with research session and findings
    const gapRows = await query<any>(
      `SELECT
         kg.*,
         ars.id as session_id,
         ars.findings as findings
       FROM knowledge_gaps kg
       LEFT JOIN LATERAL (
         SELECT id, findings
         FROM autonomous_research_sessions
         WHERE knowledge_gap_id = kg.id
         ORDER BY completed_at DESC NULLS LAST, created_at DESC
         LIMIT 1
       ) ars ON true
       WHERE kg.id = $1 AND kg.user_id = $2 AND kg.status = 'verified'`,
      [gapId, userId]
    );

    if (gapRows.length === 0) {
      throw new Error(`Gap ${gapId} not found or not in verified status`);
    }

    const gap = gapRows[0];

    if (!gap.session_id || !gap.findings) {
      throw new Error(`Gap ${gapId} missing research session or findings`);
    }

    const findings =
      typeof gap.findings === 'string' ? JSON.parse(gap.findings) : gap.findings;

    // Calculate average trust score from sources
    let trustScore = 0.5; // Default
    if (findings.sources && findings.sources.length > 0) {
      const totalScore = findings.sources.reduce(
        (sum: number, source: any) => {
          const score = source?.trustScore ?? source?.trust_score ?? 0.5;
          return sum + (typeof score === 'number' ? score : 0.5);
        },
        0
      );
      trustScore = totalScore / findings.sources.length;
    }

    // Embed knowledge
    const embeddingResult = await knowledgeEmbedder.embedKnowledge(
      userId,
      gap.session_id,
      gap.gap_description,
      findings,
      trustScore
    );

    if (!embeddingResult.success) {
      throw new Error(embeddingResult.error || 'Embedding failed');
    }

    // Update gap status to embedded
    await query(
      `UPDATE knowledge_gaps
       SET
         status = 'embedded',
         manual_approval_required = false,
         failure_reason = NULL,
         completed_at = NOW()
       WHERE id = $1`,
      [gapId]
    );

    // Create learning notification
    await query(
      `INSERT INTO notifications (user_id, type, title, message, data, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        userId,
        'autonomous_learning',
        'Research Approved and Embedded',
        `Your manually approved research on "${gap.gap_description}" has been embedded into my memory.`,
        JSON.stringify({ gapId, topic: gap.gap_description })
      ]
    );

    logger.info('Successfully embedded manually approved gap', { gapId, userId });
  } catch (error) {
    logger.error('Error embedding approved gap', { gapId, userId, error });
    throw error;
  }
}
