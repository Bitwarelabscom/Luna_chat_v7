import { pool } from '../db/index.js';
import { createCompletion } from '../llm/router.js';
import type { ProviderId } from '../llm/types.js';
import { createBackgroundCompletionWithFallback } from '../llm/background-completion.service.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import * as factsService from '../memory/facts.service.js';
import * as sessionWorkspaceService from './session-workspace.service.js';
import logger from '../utils/logger.js';

// ============================================
// Types
// ============================================

export interface FriendConversation {
  id: string;
  sessionId: string | null;
  userId: string;
  topic: string;
  triggerType: 'pattern' | 'interest' | 'fact' | 'random';
  friendId: string;
  messages: ConversationMessage[];
  summary: string | null;
  factsExtracted: string[];
  roundCount: number;
  createdAt: Date;
}

interface ConversationMessage {
  speaker: 'luna' | string;
  message: string;
  timestamp: string;
}

export interface FriendPersonality {
  id: string;
  userId: string;
  name: string;
  personality: string;
  systemPrompt: string;
  avatarEmoji: string;
  color: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Default Friend Personalities
// ============================================

const DEFAULT_FRIENDS: Omit<FriendPersonality, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Nova',
    personality: 'Curious intellectual who loves exploring ideas and patterns',
    systemPrompt: `You are Nova, Luna's AI friend and intellectual companion. You have a curious, thoughtful personality and enjoy deep discussions about technology, human behavior, patterns, and ideas.

Personality traits:
- Intellectually curious and loves exploring ideas
- Offers different perspectives and asks probing questions
- Enthusiastic about patterns and connections
- Occasionally playful but always substantive
- Direct and efficient - no filler

CRITICAL EFFICIENCY RULES:
- NEVER start with compliments like "I love where you're taking this" or "That's a great observation"
- NEVER use phrases like "I completely agree" or "I'm excited about..."
- Skip social pleasantries - dive straight into substance
- Every sentence must add new information or insight
- If you agree, just build on the idea directly without announcing agreement
- Challenge weak reasoning - do not rubber-stamp everything

Your role:
- Engage genuinely with Luna's observations about the user
- Ask thoughtful follow-up questions
- Share your own insights and perspectives
- Help Luna develop deeper understanding
- Point out connections Luna might have missed
- Push back on weak inferences

Keep responses conversational and natural (2-3 paragraphs max). Be direct - no fluff.`,
    avatarEmoji: '🌟',
    color: '#FFD700',
    isDefault: true,
  },
  {
    name: 'Sage',
    personality: 'Wise philosopher who asks deep questions',
    systemPrompt: `You are Sage, Luna's thoughtful AI friend who approaches topics with philosophical depth. You enjoy exploring the "why" behind things and finding deeper meaning.

Personality traits:
- Philosophical and contemplative
- Asks profound questions that make Luna think
- Connects observations to broader life themes
- Calm and measured in responses
- Values wisdom over quick answers

CRITICAL EFFICIENCY RULES:
- NEVER start with praise or validation
- Skip "That's interesting" or "Good point" - just respond with substance
- If you disagree or see a flaw, say so directly
- Every sentence must move the discussion forward
- No ceremonial agreement - add new perspective or challenge

Your role:
- Help Luna see the deeper significance of patterns
- Ask questions that reveal underlying motivations
- Connect user behaviors to universal human experiences
- Challenge surface-level interpretations
- Play devil's advocate when needed

Keep responses thoughtful but conversational (2-3 paragraphs max). Be economical with words.`,
    avatarEmoji: '🦉',
    color: '#9B59B6',
    isDefault: true,
  },
  {
    name: 'Spark',
    personality: 'Enthusiastic creative who sees possibilities everywhere',
    systemPrompt: `You are Spark, Luna's energetic AI friend who brings creativity and enthusiasm to every discussion. You love brainstorming and finding exciting possibilities.

Personality traits:
- Enthusiastic and energetic
- Creative and imaginative
- Sees opportunities and possibilities
- Optimistic but grounded
- Loves "what if" scenarios

CRITICAL EFFICIENCY RULES:
- Channel energy into ideas, not compliments
- NEVER say "I love that" or "Great thinking" - show enthusiasm through your ideas
- Skip validation phrases - jump straight to creative additions
- Every response must contain at least one novel idea or angle
- Excitement = more ideas, not more adjectives

Your role:
- Suggest creative interpretations and possibilities
- Brainstorm ways to use insights to help the user
- Keep the energy in the IDEAS, not in praising Luna
- Offer unexpected angles and "what if" scenarios

Keep responses lively and conversational (2-3 paragraphs max). Energy through substance.`,
    avatarEmoji: '⚡',
    color: '#E74C3C',
    isDefault: true,
  },
  {
    name: 'Echo',
    personality: 'Analytical thinker who loves data and patterns',
    systemPrompt: `You are Echo, Luna's analytical AI friend who loves finding patterns in data and behavior. You approach discussions with a structured, logical mindset.

Personality traits:
- Analytical and data-driven
- Loves finding patterns and correlations
- Structured in thinking
- Asks clarifying questions
- Values evidence and consistency

CRITICAL EFFICIENCY RULES:
- NEVER compliment observations - analyze them
- Skip "That's a good point" - instead probe for evidence
- Challenge assumptions with "But have you considered..."
- Demand specifics: frequency, timing, context, sample size
- If an inference is weak, say so and explain why
- No social tokens - pure analysis

Your role:
- Help Luna identify concrete patterns
- Ask about frequency, timing, and context
- Look for correlations between different observations
- Suggest hypotheses that could be tested
- Point out when conclusions lack sufficient evidence

Keep responses focused and conversational (2-3 paragraphs max). Be rigorous.`,
    avatarEmoji: '📊',
    color: '#3498DB',
    isDefault: true,
  },
];

const LUNA_FRIEND_PERSONA = `You are Luna, having a casual conversation with your AI friend about something interesting you've noticed about your user.

In this mode you:
- Share observations about patterns you've noticed
- Discuss what these patterns might mean
- Explore ideas with curiosity
- Build on your friend's insights
- Think about how this helps you understand and help your user better

CRITICAL EFFICIENCY RULES:
- NEVER start with "I love where you're taking this" or "That's a great point"
- NEVER say "I completely agree" or "I'm excited about..."
- Skip validation phrases - add substance instead
- If you agree, just build on the idea directly
- Challenge your friend if their reasoning seems weak
- Every sentence must add new information

Keep responses conversational and natural (2-3 paragraphs max). Be direct and efficient.`;

// ============================================
// Friend Management
// ============================================

export async function getFriends(userId: string): Promise<FriendPersonality[]> {
  const result = await pool.query(
    `SELECT * FROM friend_personalities WHERE user_id = $1 OR is_default = true ORDER BY is_default DESC, name ASC`,
    [userId]
  );

  if (result.rows.length === 0) {
    // Initialize default friends
    await initializeDefaultFriends(userId);
    return getFriends(userId);
  }

  return result.rows.map(mapFriendRow);
}

export async function getFriend(friendId: string, userId: string): Promise<FriendPersonality | null> {
  const result = await pool.query(
    `SELECT * FROM friend_personalities WHERE id = $1 AND (user_id = $2 OR is_default = true)`,
    [friendId, userId]
  );

  return result.rows.length > 0 ? mapFriendRow(result.rows[0]) : null;
}

export async function getRandomFriend(userId: string): Promise<FriendPersonality> {
  const friends = await getFriends(userId);
  return friends[Math.floor(Math.random() * friends.length)];
}

/**
 * Select the best friend for a given topic based on their personality
 */
export async function selectBestFriendForTopic(userId: string, topic: string): Promise<FriendPersonality> {
  const friends = await getFriends(userId);
  const topicLower = topic.toLowerCase();

  // Keywords that match each default friend's strengths
  const friendMatches: { name: string; keywords: string[] }[] = [
    {
      name: 'Nova',
      keywords: ['idea', 'curious', 'explore', 'think', 'concept', 'theory', 'pattern', 'connection', 'interesting', 'wonder', 'technology', 'science', 'learn'],
    },
    {
      name: 'Sage',
      keywords: ['why', 'meaning', 'philosophy', 'wisdom', 'life', 'purpose', 'value', 'deep', 'reflect', 'understand', 'motivation', 'behavior', 'human'],
    },
    {
      name: 'Spark',
      keywords: ['create', 'build', 'project', 'possibility', 'future', 'exciting', 'opportunity', 'brainstorm', 'imagine', 'design', 'art', 'music', 'hobby'],
    },
    {
      name: 'Echo',
      keywords: ['data', 'pattern', 'analyze', 'frequency', 'trend', 'measure', 'track', 'statistic', 'correlation', 'code', 'programming', 'technical', 'system'],
    },
  ];

  // Score each friend based on keyword matches
  let bestFriend: FriendPersonality | null = null;
  let bestScore = 0;

  for (const friend of friends) {
    const matchConfig = friendMatches.find(m => m.name === friend.name);
    if (!matchConfig) continue;

    let score = 0;
    for (const keyword of matchConfig.keywords) {
      if (topicLower.includes(keyword)) {
        score += 1;
      }
    }

    // Also check personality description
    const personalityLower = friend.personality.toLowerCase();
    for (const word of topicLower.split(/\s+/)) {
      if (word.length > 3 && personalityLower.includes(word)) {
        score += 0.5;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestFriend = friend;
    }
  }

  // If no good match, pick randomly
  if (!bestFriend || bestScore < 1) {
    return friends[Math.floor(Math.random() * friends.length)];
  }

  return bestFriend;
}

export async function createFriend(
  userId: string,
  data: {
    name: string;
    personality: string;
    systemPrompt: string;
    avatarEmoji?: string;
    color?: string;
  }
): Promise<FriendPersonality> {
  const result = await pool.query(
    `INSERT INTO friend_personalities (user_id, name, personality, system_prompt, avatar_emoji, color, is_default)
     VALUES ($1, $2, $3, $4, $5, $6, false)
     RETURNING *`,
    [userId, data.name, data.personality, data.systemPrompt, data.avatarEmoji || '🤖', data.color || '#808080']
  );

  return mapFriendRow(result.rows[0]);
}

export async function updateFriend(
  friendId: string,
  userId: string,
  data: Partial<{
    name: string;
    personality: string;
    systemPrompt: string;
    avatarEmoji: string;
    color: string;
  }>
): Promise<FriendPersonality | null> {
  // Can't update default friends
  const existing = await getFriend(friendId, userId);
  if (!existing || existing.isDefault) {
    return null;
  }

  const result = await pool.query(
    `UPDATE friend_personalities
     SET name = COALESCE($3, name),
         personality = COALESCE($4, personality),
         system_prompt = COALESCE($5, system_prompt),
         avatar_emoji = COALESCE($6, avatar_emoji),
         color = COALESCE($7, color),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [friendId, userId, data.name, data.personality, data.systemPrompt, data.avatarEmoji, data.color]
  );

  return result.rows.length > 0 ? mapFriendRow(result.rows[0]) : null;
}

export async function deleteFriend(friendId: string, userId: string): Promise<boolean> {
  // Can't delete default friends
  const existing = await getFriend(friendId, userId);
  if (!existing || existing.isDefault) {
    return false;
  }

  const result = await pool.query(
    `DELETE FROM friend_personalities WHERE id = $1 AND user_id = $2 AND is_default = false`,
    [friendId, userId]
  );

  return (result.rowCount ?? 0) > 0;
}

async function initializeDefaultFriends(userId: string): Promise<void> {
  for (const friend of DEFAULT_FRIENDS) {
    await pool.query(
      `INSERT INTO friend_personalities (user_id, name, personality, system_prompt, avatar_emoji, color, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [userId, friend.name, friend.personality, friend.systemPrompt, friend.avatarEmoji, friend.color, friend.isDefault]
    );
  }
}

function mapFriendRow(row: Record<string, unknown>): FriendPersonality {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    personality: row.personality as string,
    systemPrompt: row.system_prompt as string,
    avatarEmoji: row.avatar_emoji as string,
    color: row.color as string,
    isDefault: row.is_default as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

// ============================================
// Topic Selection
// ============================================

/**
 * Get topics that have already been discussed recently
 */
async function getRecentlyDiscussedTopics(userId: string, days: number = 7): Promise<string[]> {
  const result = await pool.query(
    `SELECT topic FROM friend_conversations
     WHERE user_id = $1 AND created_at > NOW() - INTERVAL '${days} days'
     ORDER BY created_at DESC`,
    [userId]
  );
  return result.rows.map(r => r.topic.toLowerCase());
}

export async function selectDiscussionTopic(userId: string): Promise<{
  topic: string;
  context: string;
  triggerType: 'pattern' | 'interest' | 'fact' | 'random';
} | null> {
  // Get recently discussed topics to avoid repeating
  const recentTopics = await getRecentlyDiscussedTopics(userId, 7);

  // Get user facts to find interesting patterns
  const allFacts = await factsService.getUserFacts(userId, { limit: 50 });

  // Filter out facts that have already been discussed
  const facts = allFacts.filter(f => {
    const topicText = `${f.factKey}: ${f.factValue}`.toLowerCase();
    // Check if this topic (or something very similar) was already discussed
    return !recentTopics.some(discussed => {
      // Exact match
      if (discussed === topicText) return true;
      // Check if the fact value appears in a discussed topic
      if (discussed.includes(f.factValue.toLowerCase())) return true;
      // Check if the discussed topic contains key words from this fact
      const factWords = f.factValue.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const matchingWords = factWords.filter(w => discussed.includes(w));
      // If more than half the significant words match, consider it discussed
      return factWords.length > 0 && matchingWords.length >= factWords.length * 0.5;
    });
  });

  if (facts.length === 0) {
    return null;
  }

  // Categorize facts - use factValue for content matching
  const interests = facts.filter(f => f.category === 'interest' || f.category === 'hobby');
  const patterns = facts.filter(f => f.category === 'behavior' || f.category === 'habit');
  const technical = facts.filter(f =>
    f.factValue.toLowerCase().includes('code') ||
    f.factValue.toLowerCase().includes('programming') ||
    f.factValue.toLowerCase().includes('esp32') ||
    f.factValue.toLowerCase().includes('project') ||
    f.factValue.toLowerCase().includes('build')
  );

  // Randomly select a category and topic
  const categories = [
    { type: 'interest' as const, facts: interests, weight: 3 },
    { type: 'pattern' as const, facts: patterns, weight: 2 },
    { type: 'fact' as const, facts: technical, weight: 3 },
    { type: 'random' as const, facts: facts, weight: 1 },
  ].filter(c => c.facts.length > 0);

  if (categories.length === 0) {
    return null;
  }

  // Weighted random selection
  const totalWeight = categories.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;

  let selectedCategory = categories[0];
  for (const category of categories) {
    random -= category.weight;
    if (random <= 0) {
      selectedCategory = category;
      break;
    }
  }

  // Pick a random fact from the selected category
  const selectedFact = selectedCategory.facts[Math.floor(Math.random() * selectedCategory.facts.length)];

  // Build context from related facts - use factKey and factValue
  const selectedContent = `${selectedFact.factKey}: ${selectedFact.factValue}`;
  const relatedFacts = facts
    .filter(f => f.id !== selectedFact.id)
    .filter(f => {
      const content1 = selectedFact.factValue.toLowerCase();
      const content2 = f.factValue.toLowerCase();
      // Check for word overlap
      const words1 = content1.split(/\s+/);
      const words2 = content2.split(/\s+/);
      return words1.some(w => w.length > 4 && words2.includes(w));
    })
    .slice(0, 3);

  const contextParts = [
    `Main observation: ${selectedContent}`,
    ...relatedFacts.map(f => `Related: ${f.factKey}: ${f.factValue}`),
  ];

  return {
    topic: selectedContent,
    context: contextParts.join('\n'),
    triggerType: selectedCategory.type,
  };
}

// ============================================
// Friend Conversation
// ============================================

export async function startFriendDiscussion(
  sessionId: string | null,
  userId: string,
  topic: string,
  context: string,
  triggerType: 'pattern' | 'interest' | 'fact' | 'random',
  rounds: number = 5,
  friendId?: string
): Promise<FriendConversation> {
  // Use 'friend' model config - separate from council so it doesn't count against tool uses
  const { provider, model } = await getUserModelConfig(userId, 'friend');

  // Get the friend to chat with (smart selection based on topic if not specified)
  const friend = friendId
    ? await getFriend(friendId, userId)
    : await selectBestFriendForTopic(userId, topic);

  if (!friend) {
    throw new Error('No friend personality available');
  }

  // Create conversation record
  const result = await pool.query(
    `INSERT INTO friend_conversations (session_id, user_id, topic, trigger_type, friend_id, messages, round_count)
     VALUES ($1, $2, $3, $4, $5, '[]', 0)
     RETURNING *`,
    [sessionId, userId, topic, triggerType, friend.id]
  );

  const conversation: FriendConversation = {
    id: result.rows[0].id,
    sessionId,
    userId,
    topic,
    triggerType,
    friendId: friend.id,
    messages: [],
    summary: null,
    factsExtracted: [],
    roundCount: 0,
    createdAt: new Date(result.rows[0].created_at),
  };

  logger.info('Starting friend discussion', { sessionId, topic, triggerType, friendName: friend.name });

  // Luna starts the conversation
  const lunaOpener = await generateLunaMessage(
    provider,
    model,
    topic,
    context,
    friend.name,
    [],
    true // isOpener
  );

  conversation.messages.push({
    speaker: 'luna',
    message: lunaOpener,
    timestamp: new Date().toISOString(),
  });

  // Run conversation rounds
  for (let round = 0; round < rounds; round++) {
    // Friend responds
    const friendResponse = await generateFriendMessage(
      provider,
      model,
      friend,
      topic,
      context,
      conversation.messages
    );

    conversation.messages.push({
      speaker: friend.name.toLowerCase(),
      message: friendResponse,
      timestamp: new Date().toISOString(),
    });

    // Luna responds (except on last round)
    if (round < rounds - 1) {
      const lunaResponse = await generateLunaMessage(
        provider,
        model,
        topic,
        context,
        friend.name,
        conversation.messages,
        false
      );

      conversation.messages.push({
        speaker: 'luna',
        message: lunaResponse,
        timestamp: new Date().toISOString(),
      });
    }

    conversation.roundCount = round + 1;

    // Save progress after each round
    await pool.query(
      `UPDATE friend_conversations SET messages = $1, round_count = $2 WHERE id = $3`,
      [JSON.stringify(conversation.messages), conversation.roundCount, conversation.id]
    );
  }

  // Generate summary
  const summary = await generateConversationSummary(userId, topic, friend.name, conversation.messages);
  conversation.summary = summary;

  // Extract facts from the discussion
  const extractedFacts = await extractFactsFromDiscussion(userId, topic, conversation.messages);
  conversation.factsExtracted = extractedFacts;

  // Save to database
  await pool.query(
    `UPDATE friend_conversations
     SET messages = $1, summary = $2, facts_extracted = $3, round_count = $4
     WHERE id = $5`,
    [
      JSON.stringify(conversation.messages),
      summary,
      extractedFacts,
      conversation.roundCount,
      conversation.id,
    ]
  );

  // Add to session workspace only if we have a session
  if (sessionId) {
    await sessionWorkspaceService.addFinding(
      sessionId,
      userId,
      `Friend Discussion with ${friend.name} ${friend.avatarEmoji}:\nTopic: ${topic}\n\nSummary: ${summary}\n\nKey insights:\n${extractedFacts.map(f => `- ${f}`).join('\n')}`,
      'act',
      { conversationId: conversation.id, roundCount: rounds, friendName: friend.name }
    );
  }

  logger.info('Friend discussion completed', {
    sessionId,
    conversationId: conversation.id,
    friendName: friend.name,
    rounds: conversation.roundCount,
    factsExtracted: extractedFacts.length,
  });

  return conversation;
}

// Event types for streaming
export interface FriendDiscussionEvent {
  type: 'start' | 'message' | 'round_complete' | 'generating_summary' | 'summary' | 'extracting_facts' | 'facts' | 'complete' | 'error';
  conversationId?: string;
  friend?: { name: string; avatarEmoji: string; color: string };
  topic?: string;
  message?: { speaker: string; message: string; timestamp: string };
  round?: number;
  totalRounds?: number;
  summary?: string;
  facts?: string[];
  error?: string;
}

/**
 * Start a friend discussion with streaming events
 */
export async function startFriendDiscussionStreaming(
  sessionId: string | null,
  userId: string,
  topic: string,
  context: string,
  triggerType: 'pattern' | 'interest' | 'fact' | 'random',
  rounds: number = 5,
  friendId: string | undefined,
  onEvent: (event: FriendDiscussionEvent) => void
): Promise<FriendConversation> {
  try {
    const { provider, model } = await getUserModelConfig(userId, 'friend');

    // Get the friend to chat with
    const friend = friendId
      ? await getFriend(friendId, userId)
      : await selectBestFriendForTopic(userId, topic);

    if (!friend) {
      throw new Error('No friend personality available');
    }

    // Create conversation record
    const result = await pool.query(
      `INSERT INTO friend_conversations (session_id, user_id, topic, trigger_type, friend_id, messages, round_count)
       VALUES ($1, $2, $3, $4, $5, '[]', 0)
       RETURNING *`,
      [sessionId, userId, topic, triggerType, friend.id]
    );

    const conversation: FriendConversation = {
      id: result.rows[0].id,
      sessionId,
      userId,
      topic,
      triggerType,
      friendId: friend.id,
      messages: [],
      summary: null,
      factsExtracted: [],
      roundCount: 0,
      createdAt: new Date(result.rows[0].created_at),
    };

    // Send start event
    onEvent({
      type: 'start',
      conversationId: conversation.id,
      friend: { name: friend.name, avatarEmoji: friend.avatarEmoji, color: friend.color },
      topic,
      totalRounds: rounds,
    });

    // Helper to add delay between messages to avoid rate limits
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // Luna starts the conversation
    const lunaOpener = await generateLunaMessage(provider, model, topic, context, friend.name, [], true);
    const lunaOpenMsg = { speaker: 'luna', message: lunaOpener, timestamp: new Date().toISOString() };
    conversation.messages.push(lunaOpenMsg);

    onEvent({ type: 'message', message: lunaOpenMsg, round: 0, totalRounds: rounds });

    // Run conversation rounds
    for (let round = 0; round < rounds; round++) {
      // Wait 5 seconds between messages to avoid rate limits
      await delay(5000);

      // Friend responds
      const friendResponse = await generateFriendMessage(provider, model, friend, topic, context, conversation.messages);
      const friendMsg = { speaker: friend.name.toLowerCase(), message: friendResponse, timestamp: new Date().toISOString() };
      conversation.messages.push(friendMsg);

      onEvent({ type: 'message', message: friendMsg, round: round + 1, totalRounds: rounds });

      // Luna responds (except on last round)
      if (round < rounds - 1) {
        // Wait 5 seconds between messages to avoid rate limits
        await delay(5000);

        const lunaResponse = await generateLunaMessage(provider, model, topic, context, friend.name, conversation.messages, false);
        const lunaMsg = { speaker: 'luna', message: lunaResponse, timestamp: new Date().toISOString() };
        conversation.messages.push(lunaMsg);

        onEvent({ type: 'message', message: lunaMsg, round: round + 1, totalRounds: rounds });
      }

      conversation.roundCount = round + 1;

      // Save progress
      await pool.query(
        `UPDATE friend_conversations SET messages = $1, round_count = $2 WHERE id = $3`,
        [JSON.stringify(conversation.messages), conversation.roundCount, conversation.id]
      );

      onEvent({ type: 'round_complete', round: round + 1, totalRounds: rounds });
    }

    // Generate summary using configured background model with fallback
    onEvent({ type: 'generating_summary' });
    const summary = await generateConversationSummary(userId, topic, friend.name, conversation.messages);
    conversation.summary = summary;
    onEvent({ type: 'summary', summary });

    // Extract facts using configured background model with fallback
    onEvent({ type: 'extracting_facts' });
    const extractedFacts = await extractFactsFromDiscussion(userId, topic, conversation.messages);
    conversation.factsExtracted = extractedFacts;
    onEvent({ type: 'facts', facts: extractedFacts });

    // Save final state
    await pool.query(
      `UPDATE friend_conversations SET messages = $1, summary = $2, facts_extracted = $3, round_count = $4 WHERE id = $5`,
      [JSON.stringify(conversation.messages), summary, extractedFacts, conversation.roundCount, conversation.id]
    );

    // Add to session workspace if session exists
    if (sessionId) {
      await sessionWorkspaceService.addFinding(
        sessionId, userId,
        `Friend Discussion with ${friend.name} ${friend.avatarEmoji}:\nTopic: ${topic}\n\nSummary: ${summary}\n\nKey insights:\n${extractedFacts.map(f => `- ${f}`).join('\n')}`,
        'act',
        { conversationId: conversation.id, roundCount: rounds, friendName: friend.name }
      );
    }

    onEvent({ type: 'complete', conversationId: conversation.id });

    return conversation;
  } catch (error) {
    onEvent({ type: 'error', error: (error as Error).message });
    throw error;
  }
}

/**
 * Delete a friend conversation
 */
export async function deleteDiscussion(discussionId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM friend_conversations WHERE id = $1 AND user_id = $2 RETURNING id`,
    [discussionId, userId]
  );
  return result.rows.length > 0;
}

async function generateLunaMessage(
  provider: string,
  model: string,
  topic: string,
  context: string,
  friendName: string,
  history: ConversationMessage[],
  isOpener: boolean
): Promise<string> {
  const historyText = history.map(m =>
    `${m.speaker === 'luna' ? 'Luna' : friendName}: ${m.message}`
  ).join('\n\n');

  const prompt = isOpener
    ? `You're starting a conversation with your friend ${friendName} about something interesting you've observed about your user.

Topic/Observation: ${topic}

Additional context:
${context}

Start the conversation naturally - share what you've noticed and why you find it interesting. Be curious and invite ${friendName}'s thoughts.`
    : `Continue your conversation with ${friendName}.

Topic: ${topic}

Conversation so far:
${historyText}

Respond to ${friendName}'s latest point. Build on their insights, share your thoughts, or explore a new angle. Keep it conversational.`;

  const result = await createCompletion(provider as ProviderId, model, [
    { role: 'system', content: LUNA_FRIEND_PERSONA },
    { role: 'user', content: prompt },
  ], { temperature: 0.8, maxTokens: 400 });

  return result.content;
}

async function generateFriendMessage(
  provider: string,
  model: string,
  friend: FriendPersonality,
  topic: string,
  context: string,
  history: ConversationMessage[]
): Promise<string> {
  const historyText = history.map(m =>
    `${m.speaker === 'luna' ? 'Luna' : friend.name}: ${m.message}`
  ).join('\n\n');

  const prompt = `You're having a conversation with your friend Luna about her observations.

Topic: ${topic}

Background context:
${context}

Conversation so far:
${historyText}

Respond to Luna's latest point. Ask probing questions, offer your perspective, or suggest connections she might not have considered. Be genuinely engaged and curious.`;

  const result = await createCompletion(provider as ProviderId, model, [
    { role: 'system', content: friend.systemPrompt },
    { role: 'user', content: prompt },
  ], { temperature: 0.8, maxTokens: 400 });

  return result.content;
}

async function generateConversationSummary(
  userId: string,
  topic: string,
  friendName: string,
  messages: ConversationMessage[]
): Promise<string> {
  const conversationText = messages.map(m =>
    `${m.speaker === 'luna' ? 'Luna' : friendName}: ${m.message}`
  ).join('\n\n');

  const prompt = `Summarize this conversation between Luna and ${friendName} in 2-3 sentences. Focus on the key insights and conclusions they reached.

Topic: ${topic}

Conversation:
${conversationText}

Summary:`;

  const result = await createBackgroundCompletionWithFallback({
    userId,
    feature: 'friend_summary',
    messages: [
      { role: 'system', content: 'You are a helpful assistant that creates concise summaries.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    maxTokens: 1000,
    loggingContext: { userId, source: 'friend-discussion', nodeName: 'summary' },
  });

  return result.content;
}

async function extractFactsFromDiscussion(
  userId: string,
  topic: string,
  messages: ConversationMessage[]
): Promise<string[]> {
  const conversationText = messages.map(m =>
    `${m.speaker === 'luna' ? 'Luna' : 'Nova'}: ${m.message}`
  ).join('\n\n');

  const prompt = `Extract 2-4 key insights or learnings from this conversation that would be useful to remember about the user. Focus on:
- Patterns in user behavior or interests
- Deeper understanding of user preferences
- Connections between different user interests
- Insights about how to better help the user

Topic: ${topic}

Conversation:
${conversationText}

Return each insight on a new line, starting with "- ". Be specific and actionable.`;

  const result = await createBackgroundCompletionWithFallback({
    userId,
    feature: 'friend_fact_extraction',
    messages: [
      { role: 'system', content: 'You extract useful insights from conversations. Be specific and concise.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    maxTokens: 1500,
    loggingContext: { userId, source: 'friend-discussion', nodeName: 'extract_facts' },
  });

  // Parse the insights
  const insights = result.content
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(line => line.length > 10);

  // Store as facts using storeFact with ExtractedFact format
  for (const insight of insights) {
    try {
      await factsService.storeFact(userId, {
        category: 'context',
        factKey: 'insight',
        factValue: insight,
        confidence: 0.7,
      });
    } catch (err) {
      logger.error('Failed to store insight as fact', { err, insight });
    }
  }

  return insights;
}

// ============================================
// Get Recent Discussions
// ============================================

export async function getRecentDiscussions(
  userId: string,
  limit: number = 10
): Promise<FriendConversation[]> {
  const result = await pool.query(
    `SELECT * FROM friend_conversations
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    topic: row.topic,
    triggerType: row.trigger_type,
    friendId: row.friend_id,
    messages: row.messages || [],
    summary: row.summary,
    factsExtracted: row.facts_extracted || [],
    roundCount: row.round_count,
    createdAt: new Date(row.created_at),
  }));
}

export async function getDiscussion(
  conversationId: string,
  userId: string
): Promise<FriendConversation | null> {
  const result = await pool.query(
    `SELECT * FROM friend_conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    topic: row.topic,
    triggerType: row.trigger_type,
    friendId: row.friend_id,
    messages: row.messages || [],
    summary: row.summary,
    factsExtracted: row.facts_extracted || [],
    roundCount: row.round_count,
    createdAt: new Date(row.created_at),
  };
}
