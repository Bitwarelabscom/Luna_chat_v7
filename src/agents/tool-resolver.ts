/**
 * Agent Registry - Tool Resolver
 *
 * Maps ToolSetId declarations from agent definitions to actual tool arrays.
 * Replaces the hardcoded if/else chains in chat.service.ts.
 */

import type { AgentDefinition, ToolSetId } from './types.js';
import { getSummonableAgents } from './registry.js';
import {
  searchTool,
  youtubeSearchTool,
  localMediaSearchTool,
  localMediaPlayTool,
  mediaDownloadTool,
  delegateToAgentTool,
  workspaceWriteTool,
  workspaceExecuteTool,
  workspaceListTool,
  workspaceReadTool,
  sendEmailTool,
  checkEmailTool,
  readEmailTool,
  deleteEmailTool,
  replyEmailTool,
  markEmailReadTool,
  sendTelegramTool,
  sendFileToTelegramTool,
  searchDocumentsTool,
  suggestGoalTool,
  fetchUrlTool,
  listTodosTool,
  createTodoTool,
  completeTodoTool,
  updateTodoTool,
  createCalendarEventTool,
  listCalendarEventsTool,
  sessionNoteTool,
  ceoNoteBuildTool,
  commitWeeklyPlanTool,
  queryDepartmentHistoryTool,
  startTaskTool,
  getTaskStatusTool,
  createReminderTool,
  listRemindersTool,
  cancelReminderTool,
  openUrlTool,
  generateImageTool,
  generateBackgroundTool,
  researchTool,
  n8nWebhookTool,
  loadContextTool,
  correctSummaryTool,
  generateArtifactTool,
  rewriteArtifactTool,
  updateHighlightedTool,
  saveArtifactFileTool,
  listArtifactsTool,
  loadArtifactTool,
  getArtifactDownloadLinkTool,
  sunoGenerateTool,
  torrentSearchTool,
  torrentDownloadTool,
  transmissionStatusTool,
  transmissionRemoveTool,
  introspectTool,
  movieGrabTool,
} from '../llm/tools/index.js';
import type OpenAI from 'openai';

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

// ============================================
// Tool set definitions
// ============================================

function getCompanionTools(): Tool[] {
  return [
    searchTool, youtubeSearchTool, localMediaSearchTool, localMediaPlayTool, mediaDownloadTool,
    fetchUrlTool,
    sendEmailTool, checkEmailTool, readEmailTool, deleteEmailTool, replyEmailTool, markEmailReadTool,
    sendTelegramTool, sendFileToTelegramTool, searchDocumentsTool, suggestGoalTool,
    listTodosTool, createTodoTool, completeTodoTool, updateTodoTool,
    createCalendarEventTool, listCalendarEventsTool,
    sessionNoteTool, createReminderTool, listRemindersTool, cancelReminderTool,
    openUrlTool,
    torrentSearchTool, torrentDownloadTool, transmissionStatusTool, transmissionRemoveTool, movieGrabTool,
    generateImageTool, generateBackgroundTool, researchTool, n8nWebhookTool, delegateToAgentTool,
    loadContextTool, correctSummaryTool,
    workspaceWriteTool, workspaceExecuteTool, workspaceListTool, workspaceReadTool,
    generateArtifactTool, rewriteArtifactTool, updateHighlightedTool, saveArtifactFileTool,
    listArtifactsTool, loadArtifactTool, getArtifactDownloadLinkTool,
    introspectTool,
  ];
}

function getDjLunaTools(): Tool[] {
  return [searchTool, fetchUrlTool, youtubeSearchTool, mediaDownloadTool, sunoGenerateTool];
}

function getCeoExtraTools(): Tool[] {
  return [ceoNoteBuildTool, commitWeeklyPlanTool, queryDepartmentHistoryTool, startTaskTool, getTaskStatusTool];
}

function getVoiceTools(): Tool[] {
  return [
    searchTool, fetchUrlTool,
    listTodosTool, createTodoTool, completeTodoTool, updateTodoTool,
    createCalendarEventTool, listCalendarEventsTool,
    checkEmailTool, readEmailTool, sendEmailTool, replyEmailTool, deleteEmailTool,
  ];
}

function getWorkspaceTools(): Tool[] {
  return [workspaceWriteTool, workspaceExecuteTool, workspaceListTool, workspaceReadTool];
}

function getSearchTools(): Tool[] {
  return [searchTool];
}

// ============================================
// Tool set resolver
// ============================================

function resolveToolSet(toolSetId: ToolSetId): Tool[] {
  switch (toolSetId) {
    case 'companion':
      return getCompanionTools();
    case 'assistant':
      // Assistant = companion + sysmon + MCP (sysmon/MCP injected by context)
      return getCompanionTools();
    case 'dj_luna':
      return getDjLunaTools();
    case 'ceo_luna':
      // CEO = assistant + CEO-specific tools (sysmon/MCP injected by context)
      return [...getCompanionTools(), ...getCeoExtraTools()];
    case 'trading':
      // Trading tools are defined in trading.service.ts, not here
      // They are injected by the trading chat service directly
      return [];
    case 'voice':
      return getVoiceTools();
    case 'workspace':
    case 'code_execution':
      return getWorkspaceTools();
    case 'search':
      return getSearchTools();
    case 'none':
      return [];
    default:
      return [];
  }
}

// ============================================
// Public API
// ============================================

export interface ToolResolverContext {
  sysmonTools?: Tool[];
  mcpTools?: Tool[];
  isSmallTalk?: boolean;
}

/**
 * Resolve the complete tool array for an agent.
 *
 * For chat_mode agents, this replaces the hardcoded if/else chain in chat.service.ts.
 * For specialist/utility agents, this is used by agents.service.ts.
 *
 * @param agent - The agent definition from the registry
 * @param context - Optional runtime context (sysmon tools, MCP tools, smalltalk detection)
 * @returns Array of OpenAI tool definitions, deduplicated by function name
 */
export function getToolsForAgent(agent: AgentDefinition, context?: ToolResolverContext): Tool[] {
  // Smalltalk = no tools
  if (context?.isSmallTalk) return [];

  const allTools: Tool[] = [];

  // Resolve each declared tool set
  for (const setId of agent.toolSets) {
    allTools.push(...resolveToolSet(setId));
  }

  // For assistant and ceo_luna, inject sysmon + MCP tools
  if (agent.toolSets.includes('assistant') || agent.toolSets.includes('ceo_luna')) {
    if (context?.sysmonTools) allTools.push(...context.sysmonTools);
    if (context?.mcpTools) allTools.push(...context.mcpTools);
  }

  // Add the summon_agent tool if this agent can summon others
  if (agent.canSummon.length > 0) {
    const summonTool = buildSummonAgentTool(agent);
    if (summonTool) allTools.push(summonTool);
  }

  // Deduplicate by function name (keep first occurrence)
  const seen = new Set<string>();
  const deduplicated: Tool[] = [];
  for (const tool of allTools) {
    const name = tool.function.name;
    if (!seen.has(name)) {
      seen.add(name);
      deduplicated.push(tool);
    }
  }

  return deduplicated;
}

// ============================================
// Summon agent tool builder
// ============================================

function buildSummonAgentTool(agent: AgentDefinition): Tool | null {
  const summonable = getSummonableAgents();
  // Filter to only agents whose category this agent can summon
  const available = summonable.filter(a => agent.canSummon.includes(a.category));
  if (available.length === 0) return null;

  const agentList = available
    .map(a => `- ${a.id}: ${a.name} - ${a.personality || a.id}`)
    .join('\n');

  return {
    type: 'function',
    function: {
      name: 'summon_agent',
      description: `Summon a specialist agent to help with a specific question or task. The summoned agent will respond with their expertise.\n\nAvailable agents:\n${agentList}\n\nUse this when a question falls outside your expertise or when a specialist would provide better answers.`,
      parameters: {
        type: 'object',
        properties: {
          agent_id: {
            type: 'string',
            enum: available.map(a => a.id),
            description: 'The ID of the agent to summon',
          },
          reason: {
            type: 'string',
            description: 'Brief description of what you need from this agent',
          },
        },
        required: ['agent_id', 'reason'],
      },
    },
  };
}
