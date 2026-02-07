import type { ExecutionStep } from './planner-orchestrator.service.js';

export interface ApprovalClassification {
  requiresApproval: boolean;
  changeType: 'structural' | 'iterative' | 'irreversible';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  affectedFiles: string[];
}

/**
 * Classifies steps to determine if approval is required
 *
 * Rules:
 * - Structural changes (new files, refactors) -> require approval
 * - Iterative changes (bug fixes, tuning) -> auto-approve
 * - Irreversible changes (deletes, external APIs) -> always require approval
 */
export async function classifyStepAction(step: ExecutionStep): Promise<ApprovalClassification> {
  const goal = step.goal.toLowerCase();
  const action = step.action;

  // Check for irreversible actions first (highest priority)
  if (isIrreversibleAction(goal, action)) {
    return {
      requiresApproval: true,
      changeType: 'irreversible',
      riskLevel: 'critical',
      reason: 'Irreversible action detected (delete, drop, external API call)',
      affectedFiles: getAffectedFiles(step.goal, step.artifact),
    };
  }

  // Check for structural changes
  if (isStructuralChange(goal, action)) {
    const riskLevel = getRiskLevel(goal, action);
    return {
      requiresApproval: true,
      changeType: 'structural',
      riskLevel,
      reason: getStructuralChangeReason(goal, action),
      affectedFiles: getAffectedFiles(step.goal, step.artifact),
    };
  }

  // Iterative changes - auto-approve
  if (isIterativeChange(goal, action)) {
    return {
      requiresApproval: false,
      changeType: 'iterative',
      riskLevel: 'low',
      reason: 'Iterative improvement - auto-approved',
      affectedFiles: getAffectedFiles(step.goal, step.artifact),
    };
  }

  // Default: require approval if uncertain
  return {
    requiresApproval: true,
    changeType: 'structural',
    riskLevel: 'medium',
    reason: 'Unclassified change - requires review',
    affectedFiles: getAffectedFiles(step.goal, step.artifact),
  };
}

/**
 * Detect irreversible actions (deletes, external API calls, database drops)
 */
function isIrreversibleAction(goal: string, _action: string): boolean {
  const irreversibleKeywords = [
    'delete',
    'remove',
    'drop',
    'truncate',
    'destroy',
    'external api',
    'api call',
    'send email',
    'post to',
    'webhook',
    'payment',
    'deploy to production',
  ];

  return irreversibleKeywords.some((keyword) => goal.includes(keyword));
}

/**
 * Detect structural changes (new files, refactors, architecture changes)
 */
// @ts-ignore - action used in if statement above
function isStructuralChange(goal: string, action: string): boolean {
  // 'build' action is always structural (creating new things)
  if (action === 'build') {
    return true;
  }

  const structuralKeywords = [
    'create',
    'add',
    'implement',
    'refactor',
    'migrate',
    'restructure',
    'architecture',
    'new file',
    'new endpoint',
    'new component',
    'new service',
    'schema change',
    'database migration',
  ];

  return structuralKeywords.some((keyword) => goal.includes(keyword));
}

/**
 * Detect iterative changes (bug fixes, optimizations, tuning)
 */
function isIterativeChange(goal: string, action: string): boolean {
  const iterativeKeywords = [
    'fix',
    'bug',
    'optimize',
    'improve',
    'tune',
    'adjust',
    'tweak',
    'update',
    'enhance',
    'performance',
    'speed up',
    'reduce',
    'increase',
  ];

  // 'modify' action with iterative keywords = iterative change
  if (action === 'modify') {
    return iterativeKeywords.some((keyword) => goal.includes(keyword));
  }

  return false;
}

/**
 * Determine risk level based on goal and action
 */
function getRiskLevel(goal: string, _action: string): 'low' | 'medium' | 'high' | 'critical' {
  const highRiskKeywords = [
    'authentication',
    'auth',
    'security',
    'encryption',
    'payment',
    'database',
    'migration',
    'production',
  ];

  const mediumRiskKeywords = [
    'api',
    'endpoint',
    'route',
    'service',
    'backend',
    'server',
  ];

  if (highRiskKeywords.some((keyword) => goal.includes(keyword))) {
    return 'high';
  }

  if (mediumRiskKeywords.some((keyword) => goal.includes(keyword))) {
    return 'medium';
  }

  return 'low';
}

/**
 * Get human-readable reason for structural change
 */
function getStructuralChangeReason(goal: string, action: string): string {
  if (action === 'build') {
    return 'Creating new files/components - requires review';
  }

  if (goal.includes('refactor')) {
    return `Code refactoring (${action}) - structural change requires review`;
  }

  if (goal.includes('migrate')) {
    return 'Migration operation - requires review';
  }

  if (goal.includes('schema')) {
    return 'Database schema change - requires review';
  }

  return 'Structural modification - requires review';
}

/**
 * Extract file paths from goal and artifact
 */
function getAffectedFiles(goal: string, artifact: string | null): string[] {
  const files: string[] = [];

  // Extract from artifact
  if (artifact) {
    files.push(artifact);
  }

  // Extract file paths from goal using common patterns
  // Matches: path/to/file.ext, filename.ext, ./relative/path.ext
  const filePathRegex = /(?:^|\s)((?:\.?\.?\/)?(?:[\w-]+\/)*[\w-]+\.\w+)/g;
  let match;

  while ((match = filePathRegex.exec(goal)) !== null) {
    const filePath = match[1];
    if (!files.includes(filePath)) {
      files.push(filePath);
    }
  }

  // Extract files mentioned in quotes
  const quotedFileRegex = /["'`]([\w\/.-]+\.\w+)["'`]/g;
  while ((match = quotedFileRegex.exec(goal)) !== null) {
    const filePath = match[1];
    if (!files.includes(filePath)) {
      files.push(filePath);
    }
  }

  return files;
}

/**
 * Check if step should skip approval (for testing/internal use)
 */
export function shouldSkipApproval(step: ExecutionStep): boolean {
  // Skip approval for 'run' and 'test' actions (read-only)
  if (step.action === 'run' || step.action === 'test') {
    return true;
  }

  // Check if explicitly marked as auto-approve in agent context
  if (step.agentContext) {
    try {
      const context = JSON.parse(step.agentContext);
      if (context.autoApprove === true) {
        return true;
      }
    } catch {
      // Ignore parse errors
    }
  }

  return false;
}
