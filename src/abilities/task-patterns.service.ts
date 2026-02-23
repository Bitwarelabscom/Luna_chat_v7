import { pool } from '../db/index.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import * as moodService from './mood.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export type TaskAction = 'created' | 'postponed' | 'completed' | 'cancelled' | 'started' | 'priority_changed';

export interface TaskHistoryEntry {
  id: string;
  taskId: string;
  action: TaskAction;
  previousDueAt?: Date;
  newDueAt?: Date;
  previousStatus?: string;
  newStatus?: string;
  moodAtAction?: Record<string, unknown>;
  reason?: string;
  dayOfWeek: number;
  hourOfDay: number;
  createdAt: Date;
}

export interface TaskCategory {
  category: string;
  totalTasks: number;
  completedCount: number;
  postponedCount: number;
  cancelledCount: number;
  completionRate: number;
  postponementRate: number;
  avgCompletionDays?: number;
  commonStruggleFactors: string[];
}

export interface TaskRecommendation {
  type: 'timing' | 'priority' | 'break_suggestion' | 'category_switch' | 'encouragement';
  message: string;
  confidence: number;
  data?: Record<string, unknown>;
}

export interface PostponementPattern {
  type: string;
  data: Record<string, unknown>;
  occurrenceCount: number;
  confidence: number;
}

// ============================================
// Task Action Recording
// ============================================

/**
 * Record a task action for pattern analysis
 */
export async function recordTaskAction(
  userId: string,
  taskId: string,
  action: TaskAction,
  details: {
    previousDueAt?: Date;
    newDueAt?: Date;
    previousStatus?: string;
    newStatus?: string;
    reason?: string;
  } = {}
): Promise<void> {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0-6
    const hourOfDay = now.getHours(); // 0-23

    // Get current mood if available
    const recentMoods = await moodService.getMoodHistory(userId, 1);
    const moodAtAction = recentMoods.length > 0 ? {
      sentiment: recentMoods[0].sentiment,
      sentimentScore: recentMoods[0].sentimentScore,
      energyLevel: recentMoods[0].energyLevel,
      emotions: recentMoods[0].emotions,
    } : null;

    await pool.query(
      `INSERT INTO task_history
        (task_id, user_id, action, previous_due_at, new_due_at, previous_status, new_status,
         mood_at_action, reason, day_of_week, hour_of_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        taskId, userId, action,
        details.previousDueAt, details.newDueAt,
        details.previousStatus, details.newStatus,
        moodAtAction ? JSON.stringify(moodAtAction) : null,
        details.reason,
        dayOfWeek, hourOfDay
      ]
    );

    // Update category stats asynchronously
    updateCategoryStats(userId, taskId, action).catch(() => {});

    // Check for postponement patterns
    if (action === 'postponed') {
      detectPostponementPattern(userId).catch(() => {});
    }

    logger.debug('Recorded task action', { userId, taskId, action });
  } catch (error) {
    logger.error('Failed to record task action', {
      error: (error as Error).message,
      userId, taskId, action
    });
  }
}

/**
 * Update category statistics based on task action
 */
async function updateCategoryStats(
  userId: string,
  taskId: string,
  action: TaskAction
): Promise<void> {
  try {
    // Get task details to determine category
    const taskResult = await pool.query(
      `SELECT title, priority FROM tasks WHERE id = $1`,
      [taskId]
    );
    if (taskResult.rows.length === 0) return;

    const category = await categorizeTask(taskResult.rows[0].title, userId);
    if (!category) return;

    // Update or create category entry
    const updateColumn = action === 'completed' ? 'completed_count'
      : action === 'postponed' ? 'postponed_count'
      : action === 'cancelled' ? 'cancelled_count'
      : null;

    if (action === 'created') {
      await pool.query(
        `INSERT INTO task_categories (user_id, category, total_tasks)
         VALUES ($1, $2, 1)
         ON CONFLICT (user_id, category) DO UPDATE SET
           total_tasks = task_categories.total_tasks + 1,
           updated_at = NOW()`,
        [userId, category]
      );
    } else if (updateColumn) {
      await pool.query(
        `UPDATE task_categories
         SET ${updateColumn} = ${updateColumn} + 1, updated_at = NOW()
         WHERE user_id = $1 AND category = $2`,
        [userId, category]
      );
    }
  } catch (error) {
    logger.error('Failed to update category stats', {
      error: (error as Error).message,
      userId, taskId
    });
  }
}

/**
 * Categorize a task based on its title
 */
async function categorizeTask(title: string, userId: string): Promise<string | null> {
  try {
    const response = await createBackgroundCompletionWithFallback({
      userId,
      feature: 'intent_detection',
      messages: [
        {
          role: 'system',
          content: `Categorize this task into ONE category. Categories:
work, health, household, personal, social, finance, learning, creative, errands, self-care

Return only the category name, nothing else.`
        },
        { role: 'user', content: title }
      ],
      temperature: 0.1,
      maxTokens: 180,
      loggingContext: {
        userId,
        source: 'task-patterns',
        nodeName: 'task_categorizer',
      }
    });

    const category = response.content?.trim().toLowerCase();
    const validCategories = ['work', 'health', 'household', 'personal', 'social', 'finance', 'learning', 'creative', 'errands', 'self-care'];
    return validCategories.includes(category || '') ? category! : 'personal';
  } catch {
    return 'personal';
  }
}

// ============================================
// Pattern Detection
// ============================================

/**
 * Detect postponement patterns for a user
 */
async function detectPostponementPattern(userId: string): Promise<void> {
  try {
    // Get recent postponements
    const result = await pool.query(
      `SELECT day_of_week, hour_of_day, mood_at_action
       FROM task_history
       WHERE user_id = $1 AND action = 'postponed'
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    if (result.rows.length < 5) return; // Not enough data

    // Analyze time-based patterns
    const dayCount: Record<number, number> = {};
    const hourCount: Record<number, number> = {};
    const moodPatterns: { lowEnergy: number; negative: number; total: number } = { lowEnergy: 0, negative: 0, total: 0 };

    for (const row of result.rows) {
      dayCount[row.day_of_week] = (dayCount[row.day_of_week] || 0) + 1;
      hourCount[row.hour_of_day] = (hourCount[row.hour_of_day] || 0) + 1;

      if (row.mood_at_action) {
        moodPatterns.total++;
        const mood = row.mood_at_action as { energyLevel?: string; sentiment?: string };
        if (mood.energyLevel === 'low') moodPatterns.lowEnergy++;
        if (mood.sentiment === 'negative' || mood.sentiment === 'very_negative') moodPatterns.negative++;
      }
    }

    // Store day-of-week pattern if significant
    const maxDay = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0];
    if (maxDay && parseInt(maxDay[1].toString()) >= result.rows.length * 0.3) {
      await pool.query(
        `INSERT INTO postponement_patterns (user_id, pattern_type, pattern_data, occurrence_count, confidence)
         VALUES ($1, 'day_of_week', $2, $3, $4)
         ON CONFLICT (user_id, pattern_type) DO UPDATE SET
           pattern_data = EXCLUDED.pattern_data,
           occurrence_count = EXCLUDED.occurrence_count,
           confidence = EXCLUDED.confidence,
           updated_at = NOW()`,
        [
          userId,
          JSON.stringify({ day: parseInt(maxDay[0]), count: dayCount }),
          result.rows.length,
          (parseInt(maxDay[1].toString()) / result.rows.length).toFixed(2)
        ]
      );
    }

    // Store mood-based pattern if significant
    if (moodPatterns.total >= 5) {
      const lowEnergyRatio = moodPatterns.lowEnergy / moodPatterns.total;
      if (lowEnergyRatio >= 0.5) {
        await pool.query(
          `INSERT INTO postponement_patterns (user_id, pattern_type, pattern_data, occurrence_count, confidence)
           VALUES ($1, 'mood_based', $2, $3, $4)
           ON CONFLICT (user_id, pattern_type) DO UPDATE SET
             pattern_data = EXCLUDED.pattern_data,
             occurrence_count = EXCLUDED.occurrence_count,
             confidence = EXCLUDED.confidence,
             updated_at = NOW()`,
          [
            userId,
            JSON.stringify({ lowEnergyRatio, negativeRatio: moodPatterns.negative / moodPatterns.total }),
            moodPatterns.total,
            lowEnergyRatio.toFixed(2)
          ]
        );
      }
    }
  } catch (error) {
    logger.error('Failed to detect postponement pattern', {
      error: (error as Error).message,
      userId
    });
  }
}

/**
 * Analyze task-mood correlations
 */
export async function calculateTaskMoodCorrelations(userId: string): Promise<void> {
  try {
    // Get completed tasks with mood data
    const result = await pool.query(
      `SELECT action, mood_at_action, day_of_week, hour_of_day
       FROM task_history
       WHERE user_id = $1 AND mood_at_action IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 200`,
      [userId]
    );

    if (result.rows.length < 10) return;

    // Analyze completion by energy level
    const completionByEnergy: Record<string, { completed: number; total: number }> = {};

    for (const row of result.rows) {
      const mood = row.mood_at_action as { energyLevel?: string };
      const energy = mood.energyLevel || 'unknown';

      if (!completionByEnergy[energy]) {
        completionByEnergy[energy] = { completed: 0, total: 0 };
      }
      completionByEnergy[energy].total++;
      if (row.action === 'completed') {
        completionByEnergy[energy].completed++;
      }
    }

    // Store correlation
    await pool.query(
      `INSERT INTO task_mood_correlations (user_id, correlation_type, correlation_data, sample_size, confidence)
       VALUES ($1, 'completion_by_energy', $2, $3, $4)
       ON CONFLICT (user_id, correlation_type) DO UPDATE SET
         correlation_data = EXCLUDED.correlation_data,
         sample_size = EXCLUDED.sample_size,
         confidence = EXCLUDED.confidence,
         last_calculated = NOW(),
         updated_at = NOW()`,
      [
        userId,
        JSON.stringify(completionByEnergy),
        result.rows.length,
        0.7
      ]
    );

    logger.debug('Calculated task-mood correlations', { userId });
  } catch (error) {
    logger.error('Failed to calculate task-mood correlations', {
      error: (error as Error).message,
      userId
    });
  }
}

// ============================================
// Pattern Retrieval
// ============================================

/**
 * Get struggle areas for a user
 */
export async function getStruggleAreas(userId: string): Promise<TaskCategory[]> {
  try {
    const result = await pool.query(
      `SELECT category, total_tasks, completed_count, postponed_count, cancelled_count,
              avg_completion_days, common_struggle_factors
       FROM task_categories
       WHERE user_id = $1 AND total_tasks >= 3
       ORDER BY
         CASE WHEN total_tasks > 0 THEN postponed_count::float / total_tasks ELSE 0 END DESC
       LIMIT 5`,
      [userId]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      category: row.category as string,
      totalTasks: row.total_tasks as number,
      completedCount: row.completed_count as number || 0,
      postponedCount: row.postponed_count as number || 0,
      cancelledCount: row.cancelled_count as number || 0,
      completionRate: row.total_tasks ? (row.completed_count as number || 0) / (row.total_tasks as number) : 0,
      postponementRate: row.total_tasks ? (row.postponed_count as number || 0) / (row.total_tasks as number) : 0,
      avgCompletionDays: row.avg_completion_days as number | undefined,
      commonStruggleFactors: (row.common_struggle_factors as string[]) || [],
    }));
  } catch (error) {
    logger.error('Failed to get struggle areas', {
      error: (error as Error).message,
      userId
    });
    return [];
  }
}

/**
 * Get postponement patterns for a user
 */
export async function getPostponementPatterns(userId: string): Promise<PostponementPattern[]> {
  try {
    const result = await pool.query(
      `SELECT pattern_type, pattern_data, occurrence_count, confidence
       FROM postponement_patterns
       WHERE user_id = $1 AND confidence >= 0.3
       ORDER BY confidence DESC`,
      [userId]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      type: row.pattern_type as string,
      data: row.pattern_data as Record<string, unknown>,
      occurrenceCount: row.occurrence_count as number,
      confidence: parseFloat(row.confidence as string),
    }));
  } catch (error) {
    logger.error('Failed to get postponement patterns', {
      error: (error as Error).message,
      userId
    });
    return [];
  }
}

// ============================================
// Recommendations
// ============================================

/**
 * Get task recommendations based on current context
 */
export async function getTaskRecommendations(
  userId: string,
  currentMood?: { sentiment: string; energyLevel?: string }
): Promise<TaskRecommendation[]> {
  const recommendations: TaskRecommendation[] = [];

  try {
    // Get patterns and correlations
    const [patterns, struggleAreas] = await Promise.all([
      getPostponementPatterns(userId),
      getStruggleAreas(userId),
    ]);

    const now = new Date();
    const dayOfWeek = now.getDay();

    // Check if current time matches a postponement pattern
    const dayPattern = patterns.find(p => p.type === 'day_of_week');
    if (dayPattern && (dayPattern.data as { day: number }).day === dayOfWeek) {
      recommendations.push({
        type: 'timing',
        message: 'You tend to postpone tasks on this day. Consider scheduling important tasks for other days.',
        confidence: dayPattern.confidence,
        data: { pattern: 'day_of_week', day: dayOfWeek }
      });
    }

    // Check mood-based patterns
    const moodPattern = patterns.find(p => p.type === 'mood_based');
    if (moodPattern && currentMood?.energyLevel === 'low') {
      const patternData = moodPattern.data as { lowEnergyRatio: number };
      if (patternData.lowEnergyRatio >= 0.5) {
        recommendations.push({
          type: 'break_suggestion',
          message: 'Your energy is low and you tend to postpone tasks in this state. Consider taking a short break first.',
          confidence: moodPattern.confidence,
        });
      }
    }

    // Recommend switching categories if current struggle area has high postponement
    const highStruggleCategory = struggleAreas.find(s => s.postponementRate >= 0.5);
    if (highStruggleCategory) {
      const easyCategory = struggleAreas.find(s => s.completionRate >= 0.7);
      if (easyCategory) {
        recommendations.push({
          type: 'category_switch',
          message: `Consider starting with a ${easyCategory.category} task to build momentum before tackling ${highStruggleCategory.category} tasks.`,
          confidence: 0.6,
          data: { struggle: highStruggleCategory.category, easy: easyCategory.category }
        });
      }
    }

    // Encouragement when mood is low but completion rate is good
    if (currentMood?.sentiment === 'negative' || currentMood?.sentiment === 'very_negative') {
      const successfulCategory = struggleAreas.find(s => s.completionRate >= 0.8);
      if (successfulCategory) {
        recommendations.push({
          type: 'encouragement',
          message: `You have an excellent track record with ${successfulCategory.category} tasks. You can do this!`,
          confidence: 0.7,
        });
      }
    }

  } catch (error) {
    logger.error('Failed to get task recommendations', {
      error: (error as Error).message,
      userId
    });
  }

  return recommendations;
}

/**
 * Format task patterns for prompt
 */
export function formatPatternsForPrompt(
  struggleAreas: TaskCategory[],
  recommendations: TaskRecommendation[]
): string {
  if (struggleAreas.length === 0 && recommendations.length === 0) return '';

  const parts: string[] = ['[Task Patterns]'];

  if (struggleAreas.length > 0) {
    const struggles = struggleAreas
      .filter(s => s.postponementRate >= 0.4)
      .slice(0, 3);

    if (struggles.length > 0) {
      parts.push('Struggle areas:');
      for (const area of struggles) {
        parts.push(`  - ${area.category}: ${Math.round(area.postponementRate * 100)}% postponement rate`);
      }
    }
  }

  if (recommendations.length > 0) {
    parts.push('\nRecommendations:');
    for (const rec of recommendations.slice(0, 3)) {
      parts.push(`  - ${rec.message}`);
    }
  }

  return parts.join('\n');
}

export default {
  recordTaskAction,
  calculateTaskMoodCorrelations,
  getStruggleAreas,
  getPostponementPatterns,
  getTaskRecommendations,
  formatPatternsForPrompt,
};
