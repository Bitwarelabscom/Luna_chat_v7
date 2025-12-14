/**
 * State Manager Node
 *
 * Entry point for the graph loop. Responsible for:
 * 1. Loading current state snapshot from event log
 * 2. Retrieving relevant memories
 * 3. Deriving new events from user input
 * 4. Updating the event log
 */

import type { GraphState } from '../schemas/graph-state.js';
import { deriveEventsFromInput, renderViewForPrompt } from '../schemas/events.js';
import * as stateStore from '../stores/state.store.js';
import * as memoryStore from '../stores/memory.store.js';
import logger from '../../utils/logger.js';

export interface StateManagerInput {
  state: GraphState;
  userId: string;
}

export interface StateManagerOutput {
  state: GraphState;
}

/**
 * State Manager Node
 *
 * Updates the graph state with:
 * - Current AgentView snapshot
 * - Relevant memories from retrieval
 * - New events derived from user input
 */
export async function stateManagerNode(
  input: StateManagerInput
): Promise<StateManagerOutput> {
  const { state, userId } = input;
  const { session_id, turn_id, user_input, agent_view } = state;

  logger.debug('State manager node executing', {
    sessionId: session_id,
    turnId: turn_id,
    inputLength: user_input.length,
  });

  try {
    // 1. Get current state snapshot (may already be populated)
    let currentView = agent_view;
    if (currentView.interaction_count === 0) {
      currentView = await stateStore.getSnapshotFast(session_id);
    }

    // 2. Build memory context with topic filtering
    const memoryContext = await memoryStore.buildMemoryContext(
      userId,
      user_input,
      session_id,
      currentView
    );

    // 3. Derive new events from user input
    const newEvents = deriveEventsFromInput(
      session_id,
      turn_id,
      user_input,
      currentView
    );

    // 4. Persist new events
    if (newEvents.length > 0) {
      await stateStore.addEvents(session_id, turn_id, newEvents);
    }

    // 5. Recompute snapshot after adding events
    const updatedView = await stateStore.getSnapshotFast(session_id);

    // 6. Format memories as strings for prompt
    const formattedMemories = [
      ...memoryContext.memories,
    ];
    if (memoryContext.facts) {
      formattedMemories.unshift(memoryContext.facts);
    }
    // Include recent actions (tool usage from legacy sessions) - important for context continuity
    if (memoryContext.recentActions) {
      formattedMemories.unshift(memoryContext.recentActions);
    }
    if (memoryContext.conversations) {
      formattedMemories.push(memoryContext.conversations);
    }

    logger.debug('State manager node completed', {
      sessionId: session_id,
      eventsAdded: newEvents.length,
      memoriesRetrieved: formattedMemories.length,
      viewTopic: updatedView.current_topic,
      viewMood: updatedView.current_mood,
    });

    return {
      state: {
        ...state,
        agent_view: updatedView,
        relevant_memories: formattedMemories,
      },
    };
  } catch (error) {
    logger.error('State manager node failed', {
      sessionId: session_id,
      error: (error as Error).message,
    });

    // Return state unchanged on error
    return { state };
  }
}

/**
 * Format state context for downstream nodes
 */
export function formatStateContext(state: GraphState): string {
  const parts: string[] = [];

  // Agent view
  const viewContext = renderViewForPrompt(state.agent_view);
  if (viewContext) {
    parts.push(viewContext);
  }

  // Relevant memories
  if (state.relevant_memories.length > 0) {
    parts.push('[Retrieved Context]');
    parts.push(state.relevant_memories.join('\n'));
  }

  return parts.join('\n\n');
}

export default {
  stateManagerNode,
  formatStateContext,
};
