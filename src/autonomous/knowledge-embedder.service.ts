/**
 * Knowledge Embedder Service
 * Embeds verified knowledge into MemoryCore
 */

import { query } from '../db/postgres.js';
import * as memorycoreClient from '../memory/memorycore.client.js';
import * as deliveryService from '../triggers/delivery.service.js';
import logger from '../utils/logger.js';
import type { ResearchFindings } from './research-coordinator.service.js';

export interface EmbeddingResult {
  success: boolean;
  interactionId?: string;
  entitiesExtracted?: number;
  error?: string;
}

/**
 * Embed verified knowledge into MemoryCore
 */
export async function embedKnowledge(
  userId: string,
  sessionId: number,
  topic: string,
  findings: ResearchFindings,
  trustScore: number
): Promise<EmbeddingResult> {
  try {
    // Construct message content from findings
    const messageContent = formatFindingsForEmbedding(topic, findings);

    // Record in MemoryCore as autonomous research interaction
    const chatSessionId = `autonomous_research_${sessionId}`;
    await memorycoreClient.recordChatInteraction(
      chatSessionId,
      'message',
      `Research topic: ${topic}`,
      {
        source: 'autonomous_research',
        research_session_id: sessionId,
        trust_score: trustScore,
      }
    );

    await memorycoreClient.recordChatInteraction(
      chatSessionId,
      'response',
      messageContent,
      {
        source: 'autonomous_research',
        research_session_id: sessionId,
        trust_score: trustScore,
        source_count: findings.sources.length,
        confidence: findings.confidence,
        sources: findings.sources.map((s) => ({
          url: s.url,
          title: s.title,
          trustScore: s.trustScore,
        })),
      }
    );

    logger.info('Knowledge recorded in MemoryCore', {
      userId,
      sessionId,
      topic,
    });

    // Extract graph entities for enhanced memory
    let entitiesExtracted = 0;
    try {
      const entities = await memorycoreClient.extractGraphEntities(
        userId,
        chatSessionId,
        messageContent,
        'model'
      );
      if (entities && entities.entities) {
        entitiesExtracted = entities.entities.length;
      }

      logger.info('Entities extracted from research', {
        userId,
        sessionId,
        entitiesExtracted,
      });
    } catch (error) {
      logger.warn('Failed to extract entities', { error, sessionId });
    }

    // Log embedding activity
    await query(
      `INSERT INTO autonomous_learning_log (
         user_id,
         action_type,
         details,
         success
       ) VALUES ($1, 'embedding', $2, true)`,
      [
        userId,
        JSON.stringify({
          sessionId,
          topic,
          interactionId: chatSessionId,
          entitiesExtracted,
          sourceCount: findings.sources.length,
          confidence: findings.confidence,
        }),
      ]
    );

    return {
      success: true,
      interactionId: chatSessionId,
      entitiesExtracted,
    };
  } catch (error) {
    logger.error('Error embedding knowledge', { error, userId, sessionId, topic });

    // Log failed embedding
    await query(
      `INSERT INTO autonomous_learning_log (
         user_id,
         action_type,
         details,
         success,
         error_message
       ) VALUES ($1, 'embedding', $2, false, $3)`,
      [
        userId,
        JSON.stringify({ sessionId, topic }),
        (error as Error).message,
      ]
    );

    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Format findings as a natural message for embedding
 */
function formatFindingsForEmbedding(topic: string, findings: ResearchFindings): string {
  const parts: string[] = [];

  parts.push(`# Research Findings: ${topic}`);
  parts.push('');
  parts.push(`**Summary**: ${findings.summary}`);
  parts.push('');

  if (findings.keyFacts.length > 0) {
    parts.push('**Key Facts**:');
    findings.keyFacts.forEach((fact) => {
      parts.push(`- ${fact}`);
    });
    parts.push('');
  }

  if (findings.sources.length > 0) {
    parts.push('**Sources**:');
    findings.sources.slice(0, 5).forEach((source, i) => {
      parts.push(
        `${i + 1}. [${source.title}](${source.url}) (trust: ${source.trustScore?.toFixed(2) || 'N/A'})`
      );
    });
    parts.push('');
  }

  parts.push(`*This knowledge was autonomously researched and verified (confidence: ${findings.confidence.toFixed(2)}).*`);

  return parts.join('\n');
}

/**
 * Create notification for user about new knowledge
 */
export async function createLearningNotification(
  userId: string,
  topic: string,
  sessionId: number
): Promise<void> {
  try {
    // Send real-time notification to frontend
    await deliveryService.sendAutonomousNotification(
      userId,
      'Luna Brain Update',
      `Luna learned about: ${topic}`,
      'autonomous.learning_complete',
      6
    );

    // Log notification activity
    await query(
      `INSERT INTO autonomous_learning_log (
         user_id,
         action_type,
         details,
         success
       ) VALUES ($1, 'notification', $2, true)`,
      [
        userId,
        JSON.stringify({
          topic,
          sessionId,
          message: `Luna learned about: ${topic}`,
        }),
      ]
    );

    logger.info('Learning notification created', { userId, topic, sessionId });
  } catch (error) {
    logger.error('Error creating learning notification', { error, userId, topic });
  }
}
