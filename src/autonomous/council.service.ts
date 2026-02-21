import { pool } from '../db/index.js';
import { createCompletion } from '../llm/router.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import * as goalsService from './goals.service.js';
import * as newsfetcherService from './newsfetcher.service.js';
import * as factsService from '../memory/facts.service.js';
import * as sessionWorkspaceService from './session-workspace.service.js';
import * as questionsService from './questions.service.js';
import * as tasksService from '../abilities/tasks.service.js';
import * as researchService from './research.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface CouncilMember {
  id: string;
  name: string;
  displayName: string;
  role: string;
  personality: string;
  functionDescription: string;
  systemPrompt: string;
  avatarEmoji: string;
  color: string;
  loopOrder: number;
  isActive: boolean;
  createdAt: Date;
}

export interface CouncilDeliberation {
  id: string;
  autonomousSessionId: string;
  userId: string;
  topic: string;
  loopNumber: number;
  conversationData: ConversationMessage[];
  participants: string[];
  summary: string | null;
  decision: string | null;
  actionTaken: string | null;
  insights: string[];
  createdAt: Date;
}

export interface ConversationMessage {
  speaker: string;
  message: string;
  timestamp: string;
  phase: string;
}

export interface CouncilResponse {
  member: CouncilMember;
  message: string;
  phase: string;
}

type CouncilPhase = 'polaris' | 'aurora' | 'vega' | 'sol';

// ============================================
// Council Members
// ============================================

export async function getCouncilMembers(): Promise<CouncilMember[]> {
  const result = await pool.query(
    `SELECT * FROM council_members WHERE is_active = true ORDER BY loop_order`
  );

  return result.rows.map(mapCouncilMemberRow);
}

export async function getCouncilMember(name: string): Promise<CouncilMember | null> {
  const result = await pool.query(
    `SELECT * FROM council_members WHERE name = $1`,
    [name]
  );

  return result.rows.length > 0 ? mapCouncilMemberRow(result.rows[0]) : null;
}

// ============================================
// Deliberations
// ============================================

export async function getDeliberations(
  userId: string,
  limit = 10,
  offset = 0
): Promise<CouncilDeliberation[]> {
  const result = await pool.query(
    `SELECT * FROM council_deliberations
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  return result.rows.map(mapDeliberationRow);
}

export async function getDeliberation(
  deliberationId: string,
  userId: string
): Promise<CouncilDeliberation | null> {
  const result = await pool.query(
    `SELECT * FROM council_deliberations WHERE id = $1 AND user_id = $2`,
    [deliberationId, userId]
  );

  return result.rows.length > 0 ? mapDeliberationRow(result.rows[0]) : null;
}

export async function getLatestDeliberation(sessionId: string): Promise<CouncilDeliberation | null> {
  const result = await pool.query(
    `SELECT * FROM council_deliberations
     WHERE autonomous_session_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId]
  );

  return result.rows.length > 0 ? mapDeliberationRow(result.rows[0]) : null;
}

export async function getSessionDeliberations(sessionId: string): Promise<CouncilDeliberation[]> {
  const result = await pool.query(
    `SELECT * FROM council_deliberations
     WHERE autonomous_session_id = $1
     ORDER BY created_at ASC`,
    [sessionId]
  );

  return result.rows.map(mapDeliberationRow);
}

// ============================================
// Council Response Generation
// ============================================

export async function getCouncilResponse(
  sessionId: string,
  userId: string,
  phase: CouncilPhase,
  userAvailable?: boolean
): Promise<CouncilResponse> {
  // Get the council member for this phase
  const member = await getCouncilMember(phase);
  if (!member) {
    throw new Error(`Council member not found: ${phase}`);
  }

  // Get or create deliberation for this session/loop
  let deliberation = await getLatestDeliberation(sessionId);
  const loopNumber = deliberation?.loopNumber ?? 1;

  if (!deliberation || phase === 'polaris') {
    // Start a new deliberation (Polaris is always first)
    deliberation = await createDeliberation(sessionId, userId, loopNumber + (phase === 'polaris' ? 1 : 0));
  }

  // Build context for this phase
  const context = await buildPhaseContext(userId, phase, deliberation, userAvailable);

  // Get user's model config for council deliberations
  const { provider, model } = await getUserModelConfig(userId, 'council');

  // Build system prompt - add user availability notice for Sol
  let systemPrompt = member.systemPrompt;
  if (phase === 'sol' && userAvailable === false) {
    systemPrompt += `\n\nIMPORTANT: The user is currently NOT AVAILABLE. You CANNOT ask the user questions - they will not be able to respond. Instead, you must:
- Use web search to find information
- Fetch web pages to gather data
- Make decisions based on available information
- Record notes and findings for later review
DO NOT suggest "ask user" as an action. Find the information yourself using search and web fetch.`;
  }

  // Generate response
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: context },
  ];

  const result = await createCompletion(provider, model, messages, {
    temperature: 0.7,
    maxTokens: 500,
    loggingContext: { userId, source: 'council', nodeName: `council_${phase}` },
  });

  const responseMessage = result.content;

  // Store the response in the deliberation
  await addMessageToDeliberation(deliberation.id, {
    speaker: phase,
    message: responseMessage,
    timestamp: new Date().toISOString(),
    phase,
  });

  // If this is Sol, also store the decision
  if (phase === 'sol') {
    await pool.query(
      `UPDATE council_deliberations SET decision = $1 WHERE id = $2`,
      [responseMessage, deliberation.id]
    );
  }

  logger.debug('Council response generated', { phase, sessionId, userId });

  return {
    member,
    message: responseMessage,
    phase,
  };
}

async function createDeliberation(
  sessionId: string,
  userId: string,
  loopNumber: number
): Promise<CouncilDeliberation> {
  // Determine topic based on context
  const goals = await goalsService.getGoals(userId, { status: 'active', limit: 1 });
  const topic = goals.length > 0
    ? `Goal Review: ${goals[0].title}`
    : 'General reflection and planning';

  const result = await pool.query(
    `INSERT INTO council_deliberations (autonomous_session_id, user_id, topic, loop_number, conversation_data)
     VALUES ($1, $2, $3, $4, '[]')
     RETURNING *`,
    [sessionId, userId, topic, loopNumber]
  );

  return mapDeliberationRow(result.rows[0]);
}

async function addMessageToDeliberation(
  deliberationId: string,
  message: ConversationMessage
): Promise<void> {
  await pool.query(
    `UPDATE council_deliberations
     SET conversation_data = conversation_data || $1::jsonb
     WHERE id = $2`,
    [JSON.stringify([message]), deliberationId]
  );
}

// ============================================
// Context Building
// ============================================

async function buildPhaseContext(
  userId: string,
  phase: CouncilPhase,
  deliberation: CouncilDeliberation,
  userAvailable?: boolean
): Promise<string> {
  const contextParts: string[] = [];
  const sessionId = deliberation.autonomousSessionId;

  // Add user availability status at the top
  if (userAvailable === false) {
    contextParts.push('[USER STATUS: NOT AVAILABLE - Cannot ask questions, must find information independently using search and web fetch]');
    contextParts.push('---');
  }

  // Add session notes context
  const sessionNotes = await sessionWorkspaceService.formatNotesForContext(sessionId);
  if (sessionNotes) {
    contextParts.push(sessionNotes);
    contextParts.push('---');
  }

  // Add previous messages from this deliberation
  if (deliberation.conversationData.length > 0) {
    contextParts.push('Previous council discussion:');
    for (const msg of deliberation.conversationData) {
      contextParts.push(`${msg.speaker.toUpperCase()}: ${msg.message}`);
    }
    contextParts.push('---');
  }

  // Add topic
  contextParts.push(`Current topic: ${deliberation.topic}`);
  contextParts.push('');

  // Phase-specific context
  switch (phase) {
    case 'polaris':
      contextParts.push(await buildPolarisContext(userId, sessionId));
      break;
    case 'aurora':
      contextParts.push(await buildAuroraContext(userId, sessionId));
      break;
    case 'vega':
      contextParts.push(await buildVegaContext(userId, deliberation));
      break;
    case 'sol':
      contextParts.push(await buildSolContext(userId, deliberation));
      break;
  }

  return contextParts.join('\n');
}

async function buildPolarisContext(userId: string, _sessionId: string): Promise<string> {
  const parts: string[] = [];

  // Get active goals
  const goals = await goalsService.getGoals(userId, { status: 'active', limit: 5 });
  if (goals.length > 0) {
    parts.push('Active goals:');
    for (const goal of goals) {
      parts.push(`- ${goal.title} (${goal.goalType}, priority: ${goal.priority})`);
    }
  } else {
    parts.push('No active goals set.');
  }

  // Get pending tasks
  const tasks = await tasksService.getTasks(userId, { status: 'pending', limit: 5 });
  if (tasks.length > 0) {
    parts.push('\nPending tasks:');
    for (const task of tasks) {
      let taskLine = `- ${task.title}`;
      if (task.priority === 'urgent' || task.priority === 'high') {
        taskLine += ` [${task.priority.toUpperCase()}]`;
      }
      if (task.dueAt) {
        const due = new Date(task.dueAt);
        const now = new Date();
        const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) taskLine += ' (OVERDUE)';
        else if (diffDays === 0) taskLine += ' (due today)';
        else if (diffDays === 1) taskLine += ' (due tomorrow)';
      }
      parts.push(taskLine);
    }
  }

  // Get recent achievements
  const achievements = await goalsService.getAchievements(userId, { limit: 3 });
  if (achievements.length > 0) {
    parts.push('\nRecent achievements:');
    for (const achievement of achievements) {
      parts.push(`- ${achievement.title}`);
    }
  }

  // Get active research collections
  const research = await researchService.getCollections(userId, { status: 'active', limit: 2 });
  if (research.length > 0) {
    parts.push('\nActive research:');
    for (const collection of research) {
      parts.push(`- ${collection.title}`);
    }
  }

  // Get user facts for context
  const facts = await factsService.getUserFacts(userId, { limit: 10 });
  if (facts.length > 0) {
    parts.push('\nKnown about the user:');
    for (const fact of facts.slice(0, 5)) {
      parts.push(`- ${fact.factValue}`);
    }
  }

  // CRITICAL: Include recently answered questions so Polaris knows what user said
  const recentlyAnswered = await questionsService.getRecentlyAnsweredQuestions(
    _sessionId,
    new Date(Date.now() - 60 * 60 * 1000) // Last hour
  );
  if (recentlyAnswered.length > 0) {
    parts.push('\nQuestions Answered by User:');
    for (const q of recentlyAnswered) {
      parts.push(`Q: ${q.question}`);
      parts.push(`A: "${q.userResponse}"`);
      parts.push('');
    }
  }

  parts.push('\nYour task: Summarize where we are. What is the current context? What goals are active? What tasks need attention? What is the priority stack?');

  return parts.join('\n');
}

async function buildAuroraContext(userId: string, sessionId: string): Promise<string> {
  const parts: string[] = [];

  // Get recently answered questions - IMPORTANT: include user's responses
  const recentlyAnswered = await questionsService.getRecentlyAnsweredQuestions(
    sessionId,
    new Date(Date.now() - 30 * 60 * 1000) // Last 30 minutes
  );
  if (recentlyAnswered.length > 0) {
    parts.push('USER RESPONSES (incorporate these into your thinking):');
    for (const q of recentlyAnswered) {
      parts.push(`Q: ${q.question}`);
      parts.push(`User answered: "${q.userResponse}"`);
      parts.push('');
    }
    parts.push('---');
  }

  // Get recent interesting articles from newsfetcher
  const articles = await newsfetcherService.getInterestingArticles(5);
  if (articles.length > 0) {
    parts.push('Recent interesting articles:');
    for (const article of articles) {
      parts.push(`- ${article.title} [${article.verificationStatus}] (confidence: ${article.confidenceScore}%)`);
    }
  }

  // Get session learnings
  const learnings = await getRecentLearnings(userId, 3);
  if (learnings.length > 0) {
    parts.push('\nRecent learnings:');
    for (const learning of learnings) {
      parts.push(`- ${learning.learningContent}`);
    }
  }

  // Check for pending questions
  const pendingQuestions = await questionsService.getPendingQuestions(userId, 5);
  if (pendingQuestions.length > 0) {
    parts.push('\nQuestions still waiting for user response:');
    for (const q of pendingQuestions) {
      parts.push(`- ${q.question}`);
    }
  }

  parts.push('\nYour task: Sense if anything has shifted. Review the user responses above - what did we learn? Are there new patterns? Has something changed? Are any goals feeling stale?');

  return parts.join('\n');
}

async function buildVegaContext(_userId: string, deliberation: CouncilDeliberation): Promise<string> {
  const parts: string[] = [];

  // Find what Aurora mentioned
  const auroraMessage = deliberation.conversationData.find(m => m.speaker === 'aurora');
  if (auroraMessage) {
    parts.push('Aurora observed:');
    parts.push(auroraMessage.message);
    parts.push('');
  }

  // Get any relevant research data from newsfetcher
  const articles = await newsfetcherService.getInterestingArticles(3);
  if (articles.length > 0) {
    parts.push('Available research data:');
    for (const article of articles) {
      parts.push(`- ${article.title} [${article.verificationStatus}, ${article.confidenceScore}%]`);
      if (article.signalReason) {
        parts.push(`  Analysis: ${article.signalReason}`);
      }
    }
  }

  parts.push('\nYour task: Validate any assumptions. What do we need to know before acting? Are there risks to consider? Do we have enough data?');

  return parts.join('\n');
}

async function buildSolContext(userId: string, deliberation: CouncilDeliberation): Promise<string> {
  const parts: string[] = [];
  const sessionId = deliberation.autonomousSessionId;

  // Get recently answered questions - ensure Sol sees user responses
  const recentlyAnswered = await questionsService.getRecentlyAnsweredQuestions(
    sessionId,
    new Date(Date.now() - 30 * 60 * 1000) // Last 30 minutes
  );
  if (recentlyAnswered.length > 0) {
    parts.push('USER RESPONSES (the user answered these questions):');
    for (const q of recentlyAnswered) {
      parts.push(`Q: ${q.question}`);
      parts.push(`User answered: "${q.userResponse}"`);
      parts.push('');
    }
    parts.push('---');
  }

  // Summarize what the council has said
  parts.push('Council discussion summary:');
  for (const msg of deliberation.conversationData) {
    parts.push(`${msg.speaker.toUpperCase()}: ${msg.message.slice(0, 200)}...`);
  }

  // Check user availability
  const userAvailable = await questionsService.getUserAvailability(userId);
  parts.push('');
  parts.push(`User availability: ${userAvailable ? 'AVAILABLE - you can ask questions directly' : 'NOT AVAILABLE - work independently'}`);

  // Available action types
  parts.push('');
  parts.push('Available actions you can decide:');
  parts.push('- "create task: [task description]" - Create a new task for the user');
  parts.push('- "complete task: [task name]" - Mark a task as completed');
  parts.push('- "ask user: [question]" - Ask the user a question (add "urgent" if priority 8+)');
  parts.push('- "note: [content]" - Record a note or observation');
  parts.push('- "fetch web page: [URL]" - Retrieve web page content');
  parts.push('- "collect research: [URL or finding]" - Add to research collection');
  parts.push('- "write file: [filename] content: [content]" - Save a file to workspace');
  parts.push('- "read file: [filename]" - Read a file from workspace');
  parts.push('- "goal: create/update [details]" - Work with goals');
  parts.push('- "research" - Refresh RSS feeds and research');
  parts.push('- "sleep" - End this cycle, nothing more to do');

  parts.push('');
  parts.push('Your task: Make the decision. What is the next action? Be specific and actionable. If you need user input, phrase it as "ask user: [question]".');

  return parts.join('\n');
}

async function getRecentLearnings(userId: string, limit: number): Promise<Array<{ learningContent: string }>> {
  const result = await pool.query(
    `SELECT learning_content FROM session_learnings
     WHERE user_id = $1 AND is_active = true
     ORDER BY updated_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map(row => ({
    learningContent: row.learning_content,
  }));
}

// ============================================
// Summary Generation
// ============================================

export async function generateDeliberationSummary(deliberationId: string, userId: string): Promise<string> {
  const deliberation = await getDeliberation(deliberationId, userId);
  if (!deliberation) {
    throw new Error('Deliberation not found');
  }

  if (deliberation.conversationData.length === 0) {
    return 'No discussion recorded.';
  }

  const { provider, model } = await getUserModelConfig(userId, 'council');

  const conversationText = deliberation.conversationData
    .map(m => `${m.speaker.toUpperCase()}: ${m.message}`)
    .join('\n\n');

  const messages = [
    {
      role: 'system' as const,
      content: 'Summarize this council deliberation in 2-3 sentences. Focus on the key decision and reasoning.',
    },
    {
      role: 'user' as const,
      content: conversationText,
    },
  ];

  const result = await createCompletion(provider, model, messages, {
    temperature: 0.3,
    maxTokens: 200,
    loggingContext: { userId, source: 'council', nodeName: 'council_summary' },
  });

  // Store the summary
  await pool.query(
    `UPDATE council_deliberations SET summary = $1 WHERE id = $2`,
    [result.content, deliberationId]
  );

  return result.content;
}

// ============================================
// Helpers
// ============================================

function mapCouncilMemberRow(row: Record<string, unknown>): CouncilMember {
  return {
    id: row.id as string,
    name: row.name as string,
    displayName: row.display_name as string,
    role: row.role as string,
    personality: row.personality as string,
    functionDescription: row.function_description as string,
    systemPrompt: row.system_prompt as string,
    avatarEmoji: row.avatar_emoji as string,
    color: row.color as string,
    loopOrder: row.loop_order as number,
    isActive: row.is_active as boolean,
    createdAt: new Date(row.created_at as string),
  };
}

function mapDeliberationRow(row: Record<string, unknown>): CouncilDeliberation {
  return {
    id: row.id as string,
    autonomousSessionId: row.autonomous_session_id as string,
    userId: row.user_id as string,
    topic: row.topic as string,
    loopNumber: row.loop_number as number,
    conversationData: (row.conversation_data as ConversationMessage[]) || [],
    participants: (row.participants as string[]) || [],
    summary: row.summary as string | null,
    decision: row.decision as string | null,
    actionTaken: row.action_taken as string | null,
    insights: (row.insights as string[]) || [],
    createdAt: new Date(row.created_at as string),
  };
}

// ============================================
// Exported Helpers for Autonomous Service
// ============================================

export async function getUserModelConfigForCouncil(userId: string): Promise<{ provider: string; model: string }> {
  return getUserModelConfig(userId, 'council');
}

export async function createCompletionWithConfig(
  provider: string,
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<{ content: string }> {
  // Cast provider to the expected type - the model config service returns valid provider IDs
  return createCompletion(provider as Parameters<typeof createCompletion>[0], model, messages, options);
}
