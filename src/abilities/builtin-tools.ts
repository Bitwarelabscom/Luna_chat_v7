/**
 * Built-in tools that Luna always has access to
 * These are system-level tools that don't require user configuration
 */

export interface BuiltinTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

/**
 * Research tool - Uses Claude CLI (Opus 4.5) for in-depth research
 */
export const RESEARCH_TOOL: BuiltinTool = {
  name: 'research',
  description: 'Conduct in-depth research using Claude Opus 4.5. Can search the web, analyze code, process documents, and perform data analysis. Use this for complex questions that require thorough investigation. Results can optionally be saved to the workspace.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The research question or topic to investigate thoroughly',
      },
      depth: {
        type: 'string',
        description: 'Research depth - "quick" for simple lookups (1-2 min), "thorough" for comprehensive analysis (5-10 min)',
        enum: ['quick', 'thorough'],
      },
      save_to_file: {
        type: 'string',
        description: 'Optional filename to save research results in workspace (e.g., "market-analysis.md"). File will be saved in the research/ folder.',
      },
    },
    required: ['query'],
  },
};

/**
 * All built-in tools
 */
export const BUILTIN_TOOLS: BuiltinTool[] = [
  RESEARCH_TOOL,
];

/**
 * Format built-in tools for LLM function calling (OpenAI/Anthropic format)
 */
export function formatBuiltinToolsForLLM(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: object;
  };
}> {
  return BUILTIN_TOOLS.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Check if a tool name is a built-in tool
 */
export function isBuiltinTool(toolName: string): boolean {
  return BUILTIN_TOOLS.some(t => t.name === toolName);
}

export default {
  BUILTIN_TOOLS,
  RESEARCH_TOOL,
  formatBuiltinToolsForLLM,
  isBuiltinTool,
};
