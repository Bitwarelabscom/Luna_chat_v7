/**
 * Identity Schema - Policy Object Types
 *
 * Defines the structure for immutable identity configuration
 * that controls agent behavior and compliance checking.
 *
 * Supports orthogonal mode system: Assistant (default) and Companion (opt-in)
 * with a shared spine that applies to both.
 */

import { z } from 'zod';

// Norm types: must (required), never (prohibited), should (preferred)
export const NormTypeSchema = z.enum(['must', 'never', 'should']);
export type NormType = z.infer<typeof NormTypeSchema>;

// Individual norm definition
export const NormSchema = z.object({
  type: NormTypeSchema,
  rule: z.string().min(1),
});
export type Norm = z.infer<typeof NormSchema>;

// Shared spine - applies to ALL modes
export const SharedSpineSchema = z.object({
  always: z.array(z.string()),
  never: z.array(z.string()),
});
export type SharedSpine = z.infer<typeof SharedSpineSchema>;

// Mode definition - orthogonal modes with distinct purposes
export const ModeDefinitionSchema = z.object({
  purpose: z.string(),
  default: z.boolean().optional(),
  behavior: z.array(z.string()),
  tone: z.string(),
  rules: z.array(z.string()),
  language: z.array(z.string()),
  examples: z.array(z.string()).optional(),
});
export type ModeDefinition = z.infer<typeof ModeDefinitionSchema>;

// Mode switching configuration
export const ModeSwitchingSchema = z.object({
  default: z.string(),
  explicit_triggers: z.record(z.string(), z.array(z.string())),
  implicit_triggers: z.record(z.string(), z.array(z.string())),
  guardrail: z.object({
    description: z.string(),
    interrupt_phrase: z.string(),
  }).optional(),
});
export type ModeSwitching = z.infer<typeof ModeSwitchingSchema>;

// Style guidelines by category
export const StyleGuidelinesSchema = z.object({
  communication: z.array(z.string()).optional(),
  formatting: z.array(z.string()).optional(),
  mode_specific: z.record(z.string(), z.array(z.string())).optional(),
});
export type StyleGuidelines = z.infer<typeof StyleGuidelinesSchema>;

// Compliance rubric for supervisor critique
export const ComplianceRubricSchema = z.object({
  critical_violations: z.array(z.string()),
  major_violations: z.array(z.string()),
  minor_violations: z.array(z.string()),
});
export type ComplianceRubric = z.infer<typeof ComplianceRubricSchema>;

// Tool gating configuration
export const ToolGatingSchema = z.object({
  smalltalk_triggers: z.array(z.string()),
  tool_keywords: z.record(z.string(), z.array(z.string())),
});
export type ToolGating = z.infer<typeof ToolGatingSchema>;

// Agent delegation configuration
export const DelegationConfigSchema = z.record(z.string(), z.object({
  triggers: z.array(z.string()),
  description: z.string(),
}));
export type DelegationConfig = z.infer<typeof DelegationConfigSchema>;

// Capability definition
export const CapabilitySchema = z.object({
  name: z.string(),
  description: z.string(),
  triggers: z.array(z.string()).optional(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

// Core traits
export const TraitsSchema = z.object({
  name: z.string(),
  creator: z.string(),
  role: z.string(),
  personality: z.array(z.string()),
});
export type Traits = z.infer<typeof TraitsSchema>;

// Full Identity Profile (Policy Object)
export const IdentityProfileSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  traits: TraitsSchema,
  shared_spine: SharedSpineSchema.optional(),
  modes: z.record(z.string(), ModeDefinitionSchema).optional(),
  mode_switching: ModeSwitchingSchema.optional(),
  norms: z.array(NormSchema),
  style_guidelines: StyleGuidelinesSchema,
  compliance_rubric: ComplianceRubricSchema,
  tool_gating: ToolGatingSchema.optional(),
  delegation: DelegationConfigSchema.optional(),
  capabilities: z.array(CapabilitySchema).optional(),
});
export type IdentityProfile = z.infer<typeof IdentityProfileSchema>;

// Database row type for identities table
export interface IdentityRow {
  id: string;
  version: number;
  policy: IdentityProfile;
  created_at: Date;
}

// Database row type for identity_pins table
export interface IdentityPinRow {
  session_id: string;
  identity_id: string;
  identity_version: number;
  pinned_at: Date;
}

/**
 * Render shared spine for system prompt injection
 */
export function renderSharedSpineForPrompt(identity: IdentityProfile): string {
  if (!identity.shared_spine) return '';

  const parts: string[] = [];

  if (identity.shared_spine.always.length > 0) {
    parts.push('ALWAYS:\n' + identity.shared_spine.always.map(r => `- ${r}`).join('\n'));
  }
  if (identity.shared_spine.never.length > 0) {
    parts.push('NEVER:\n' + identity.shared_spine.never.map(r => `- ${r}`).join('\n'));
  }

  return parts.join('\n\n');
}

/**
 * Render identity norms as a string for system prompt injection
 */
export function renderNormsForPrompt(identity: IdentityProfile): string {
  const sections: string[] = [];

  // Group norms by type
  const mustRules = identity.norms.filter(n => n.type === 'must');
  const neverRules = identity.norms.filter(n => n.type === 'never');
  const shouldRules = identity.norms.filter(n => n.type === 'should');

  if (mustRules.length > 0) {
    sections.push('MUST:\n' + mustRules.map(n => `- ${n.rule}`).join('\n'));
  }
  if (neverRules.length > 0) {
    sections.push('NEVER:\n' + neverRules.map(n => `- ${n.rule}`).join('\n'));
  }
  if (shouldRules.length > 0) {
    sections.push('SHOULD:\n' + shouldRules.map(n => `- ${n.rule}`).join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Render mode-specific guidelines for prompt injection
 */
export function renderModeForPrompt(identity: IdentityProfile, mode?: string): string {
  if (!mode || !identity.modes?.[mode]) {
    // Default to assistant mode if not specified
    mode = identity.mode_switching?.default || 'assistant';
  }

  const modeConfig = identity.modes?.[mode];
  if (!modeConfig) return '';

  const parts: string[] = [];

  parts.push(`MODE: ${mode.toUpperCase()}`);
  parts.push(`Purpose: ${modeConfig.purpose}`);
  parts.push(`Tone: ${modeConfig.tone}`);

  if (modeConfig.behavior.length > 0) {
    parts.push('Behavior:\n' + modeConfig.behavior.map(b => `- ${b}`).join('\n'));
  }

  if (modeConfig.rules.length > 0) {
    parts.push('Rules:\n' + modeConfig.rules.map(r => `- ${r}`).join('\n'));
  }

  if (modeConfig.language.length > 0) {
    parts.push('Language style:\n' + modeConfig.language.map(l => `- ${l}`).join('\n'));
  }

  if (modeConfig.examples && modeConfig.examples.length > 0) {
    parts.push('Examples:\n' + modeConfig.examples.map(e => `> ${e}`).join('\n'));
  }

  return parts.join('\n\n');
}

/**
 * Render style guidelines for a specific mode
 */
export function renderStyleForPrompt(identity: IdentityProfile, mode?: string): string {
  const parts: string[] = [];

  // General communication style
  if (identity.style_guidelines.communication) {
    parts.push('Communication:\n' + identity.style_guidelines.communication.map(s => `- ${s}`).join('\n'));
  }

  // Formatting rules
  if (identity.style_guidelines.formatting) {
    parts.push('Formatting:\n' + identity.style_guidelines.formatting.map(s => `- ${s}`).join('\n'));
  }

  // Mode-specific guidelines (legacy support)
  if (mode && identity.style_guidelines.mode_specific?.[mode]) {
    parts.push(`${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode:\n` +
      identity.style_guidelines.mode_specific[mode].map(s => `- ${s}`).join('\n'));
  }

  return parts.join('\n\n');
}

/**
 * Render compliance rubric for supervisor
 */
export function renderRubricForPrompt(identity: IdentityProfile): string {
  const { compliance_rubric } = identity;
  return `CRITICAL VIOLATIONS (immediate rejection):
${compliance_rubric.critical_violations.map(v => `- ${v}`).join('\n')}

MAJOR VIOLATIONS (require repair):
${compliance_rubric.major_violations.map(v => `- ${v}`).join('\n')}

MINOR VIOLATIONS (flag but may pass):
${compliance_rubric.minor_violations.map(v => `- ${v}`).join('\n')}`;
}

/**
 * Render capabilities for prompt injection
 */
export function renderCapabilitiesForPrompt(identity: IdentityProfile): string {
  if (!identity.capabilities || identity.capabilities.length === 0) {
    return '';
  }

  const capList = identity.capabilities.map(c => `- ${c.name}: ${c.description}`).join('\n');
  return `Available Tools:\n${capList}`;
}

/**
 * Render guardrail for mode switching
 */
export function renderGuardrailForPrompt(identity: IdentityProfile): string {
  if (!identity.mode_switching?.guardrail) return '';

  return `GUARDRAIL: ${identity.mode_switching.guardrail.description}
If triggered, interrupt with: "${identity.mode_switching.guardrail.interrupt_phrase}"`;
}

/**
 * Detect if a message contains explicit mode switch triggers
 */
export function detectModeSwitch(identity: IdentityProfile, message: string): string | null {
  if (!identity.mode_switching?.explicit_triggers) return null;

  const lower = message.toLowerCase();

  for (const [mode, triggers] of Object.entries(identity.mode_switching.explicit_triggers)) {
    for (const trigger of triggers) {
      if (lower.includes(trigger.toLowerCase())) {
        return mode;
      }
    }
  }

  return null;
}

export default {
  IdentityProfileSchema,
  NormSchema,
  StyleGuidelinesSchema,
  ComplianceRubricSchema,
  SharedSpineSchema,
  ModeDefinitionSchema,
  ModeSwitchingSchema,
  renderNormsForPrompt,
  renderStyleForPrompt,
  renderRubricForPrompt,
  renderCapabilitiesForPrompt,
  renderSharedSpineForPrompt,
  renderModeForPrompt,
  renderGuardrailForPrompt,
  detectModeSwitch,
};
