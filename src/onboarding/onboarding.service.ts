import { pool } from '../db/index.js';
import { storeFact, getUserFacts, type ExtractedFact } from '../memory/facts.service.js';
import logger from '../utils/logger.js';

export interface OnboardingState {
  id: string;
  userId: string;
  status: 'not_started' | 'in_progress' | 'reviewing' | 'completed';
  currentPhase: number;
  currentSection: string;
  collectedData: Record<string, Record<string, string>>;
  sectionStatus: Record<string, 'pending' | 'done' | 'skipped'>;
  sessionId: string | null;
  factsCommitted: boolean;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

// Section ordering across all phases
interface SectionDef {
  section: string;
  phase: number;
}

export const ORDERED_SECTIONS: SectionDef[] = [
  // Phase 1: Discovery
  { section: 'identity',      phase: 1 },
  { section: 'household',     phase: 1 },
  { section: 'work',          phase: 1 },
  { section: 'interests',     phase: 1 },
  { section: 'technical',     phase: 1 },
  { section: 'communication', phase: 1 },
  { section: 'health',        phase: 1 },
  // Phase 2: Business
  { section: 'projects',      phase: 2 },
  { section: 'resources',     phase: 2 },
  { section: 'goals',         phase: 2 },
  // Phase 3: System
  { section: 'telegram',      phase: 3 },
  { section: 'integrations',  phase: 3 },
  { section: 'tour',          phase: 3 },
  // Phase 4: Review
  { section: 'review',        phase: 4 },
  { section: 'commit',        phase: 4 },
];

// Category mapping from onboarding section -> fact category
const SECTION_CATEGORY_MAP: Record<string, string> = {
  identity:      'personal',
  household:     'relationship',
  work:          'work',
  interests:     'hobby',
  technical:     'preference',
  communication: 'preference',
  health:        'personal',
  projects:      'goal',
  resources:     'context',
  goals:         'goal',
  telegram:      'preference',
  integrations:  'preference',
  tour:          'context',
  review:        'context',
  commit:        'context',
};

// Guidance text per section (what to learn)
const SECTION_GUIDANCE: Record<string, string> = {
  identity:
    'Learn about: name, age or birthday, location (city/country), pronouns, timezone',
  household:
    'Learn about: who they live with (partner, roommates, alone), pets, family situation',
  work:
    'Learn about: job title/role, company/industry, schedule, remote vs office',
  interests:
    'Learn about: hobbies, entertainment preferences, sports, music taste, creative pursuits',
  technical:
    'Learn about: OS preference, coding languages (if any), tools they use, tech comfort level',
  communication:
    'Learn about: preferred name/nicknames, formality level, humor style, topics to avoid',
  health:
    'Learn about: sleep schedule, exercise habits, dietary preferences (be gentle - these are optional)',
  projects:
    'Learn about: current projects, side projects, what they want to use Luna for',
  resources:
    'Learn about: tools they use daily, key services, accounts Luna might help with',
  goals:
    'Learn about: personal goals, professional goals, things they want to learn or improve',
  telegram:
    'Mention: they can connect Telegram for mobile access to Luna - ask if they want to set it up',
  integrations:
    'Brief check: what services Luna can connect to (calendar, email, Spotify, etc.) - any they want to enable?',
  tour:
    'Quick overview: Luna has Companion mode (personal), Assistant mode (tasks/code), DJ Luna (music), CEO Luna (business)',
  review:
    'Present a summary of everything collected. Ask if anything needs correction or if they want to add anything.',
  commit:
    'Confirm all the information is correct and save it. This completes the onboarding.',
};

function mapRowToState(row: Record<string, unknown>): OnboardingState {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    status: row.status as OnboardingState['status'],
    currentPhase: row.current_phase as number,
    currentSection: row.current_section as string,
    collectedData: (row.collected_data as Record<string, Record<string, string>>) || {},
    sectionStatus: (row.section_status as Record<string, 'pending' | 'done' | 'skipped'>) || {},
    sessionId: row.session_id as string | null,
    factsCommitted: row.facts_committed as boolean,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    completedAt: row.completed_at as Date | null,
  };
}

export async function getOnboardingState(userId: string): Promise<OnboardingState | null> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM user_onboarding WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) return null;
    return mapRowToState(result.rows[0] as Record<string, unknown>);
  } finally {
    client.release();
  }
}

export async function initOnboarding(userId: string, sessionId?: string): Promise<OnboardingState> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO user_onboarding
         (user_id, status, current_phase, current_section, collected_data, section_status, session_id, facts_committed)
       VALUES ($1, 'in_progress', 1, 'identity', '{}', '{}', $2, false)
       ON CONFLICT (user_id) DO UPDATE SET
         status = 'in_progress',
         current_phase = 1,
         current_section = 'identity',
         collected_data = '{}',
         section_status = '{}',
         session_id = $2,
         facts_committed = false,
         updated_at = NOW(),
         completed_at = NULL
       RETURNING *`,
      [userId, sessionId || null]
    );
    return mapRowToState(result.rows[0] as Record<string, unknown>);
  } finally {
    client.release();
  }
}

export async function updateCollectedData(
  userId: string,
  section: string,
  data: Record<string, string>
): Promise<void> {
  if (!data || Object.keys(data).length === 0) return;
  const client = await pool.connect();
  try {
    // Merge new key-value pairs into the section's sub-object in collected_data JSONB
    await client.query(
      `UPDATE user_onboarding
       SET collected_data = jsonb_set(
         collected_data,
         ARRAY[$2],
         COALESCE(collected_data->$2, '{}') || $3::jsonb
       ),
       updated_at = NOW()
       WHERE user_id = $1`,
      [userId, section, JSON.stringify(data)]
    );
  } finally {
    client.release();
  }
}

export async function advanceSection(userId: string): Promise<OnboardingState | null> {
  const client = await pool.connect();
  try {
    // Get current state
    const stateResult = await client.query(
      'SELECT * FROM user_onboarding WHERE user_id = $1',
      [userId]
    );
    if (stateResult.rows.length === 0) return null;
    const state = mapRowToState(stateResult.rows[0] as Record<string, unknown>);

    // Mark current section as done
    const updatedSectionStatus = {
      ...state.sectionStatus,
      [state.currentSection]: 'done' as const,
    };

    // Find next section
    const currentIdx = ORDERED_SECTIONS.findIndex(s => s.section === state.currentSection);
    const nextDef = currentIdx >= 0 ? ORDERED_SECTIONS[currentIdx + 1] : undefined;

    let newStatus: OnboardingState['status'] = state.status;
    let newSection = state.currentSection;
    let newPhase = state.currentPhase;
    let completedAt: Date | null = null;

    if (!nextDef) {
      // Past last section - mark completed
      newStatus = 'completed';
      completedAt = new Date();
    } else {
      newSection = nextDef.section;
      newPhase = nextDef.phase;
      // Entering review phase
      if (nextDef.phase === 4 && nextDef.section === 'review') {
        newStatus = 'reviewing';
      }
    }

    const result = await client.query(
      `UPDATE user_onboarding SET
         section_status = $2,
         current_section = $3,
         current_phase = $4,
         status = $5,
         completed_at = $6,
         updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, JSON.stringify(updatedSectionStatus), newSection, newPhase, newStatus, completedAt]
    );

    return mapRowToState(result.rows[0] as Record<string, unknown>);
  } finally {
    client.release();
  }
}

export async function skipSection(userId: string, section?: string): Promise<OnboardingState | null> {
  const client = await pool.connect();
  try {
    // Get current state to know which section to skip
    const stateResult = await client.query(
      'SELECT * FROM user_onboarding WHERE user_id = $1',
      [userId]
    );
    if (stateResult.rows.length === 0) return null;
    const state = mapRowToState(stateResult.rows[0] as Record<string, unknown>);

    const targetSection = section || state.currentSection;

    // Mark target section as skipped
    const updatedSectionStatus = {
      ...state.sectionStatus,
      [targetSection]: 'skipped' as const,
    };

    // If skipping a non-current section, just update that status
    if (targetSection !== state.currentSection) {
      await client.query(
        `UPDATE user_onboarding SET section_status = $2, updated_at = NOW() WHERE user_id = $1`,
        [userId, JSON.stringify(updatedSectionStatus)]
      );
      return getOnboardingState(userId);
    }

    // Skipping current section - advance to next
    const currentIdx = ORDERED_SECTIONS.findIndex(s => s.section === state.currentSection);
    const nextDef = currentIdx >= 0 ? ORDERED_SECTIONS[currentIdx + 1] : undefined;

    let newStatus: OnboardingState['status'] = state.status;
    let newSection = state.currentSection;
    let newPhase = state.currentPhase;
    let completedAt: Date | null = null;

    if (!nextDef) {
      newStatus = 'completed';
      completedAt = new Date();
    } else {
      newSection = nextDef.section;
      newPhase = nextDef.phase;
      if (nextDef.phase === 4 && nextDef.section === 'review') {
        newStatus = 'reviewing';
      }
    }

    const result = await client.query(
      `UPDATE user_onboarding SET
         section_status = $2,
         current_section = $3,
         current_phase = $4,
         status = $5,
         completed_at = $6,
         updated_at = NOW()
       WHERE user_id = $1
       RETURNING *`,
      [userId, JSON.stringify(updatedSectionStatus), newSection, newPhase, newStatus, completedAt]
    );

    return mapRowToState(result.rows[0] as Record<string, unknown>);
  } finally {
    client.release();
  }
}

export async function commitFacts(userId: string): Promise<{ count: number }> {
  // Get current state
  const state = await getOnboardingState(userId);
  if (!state) return { count: 0 };

  let count = 0;
  const sessionId = state.sessionId || undefined;

  for (const [section, data] of Object.entries(state.collectedData)) {
    if (!data || typeof data !== 'object') continue;
    const category = SECTION_CATEGORY_MAP[section] || 'context';

    for (const [key, value] of Object.entries(data)) {
      if (!value || typeof value !== 'string' || !value.trim()) continue;
      const fact: ExtractedFact = {
        category,
        factKey: key,
        factValue: value.trim(),
        confidence: 1.0,
        factType: 'permanent',
        isCorrection: true,
      };
      try {
        await storeFact(userId, fact, undefined, sessionId, null);
        count++;
      } catch (err) {
        logger.debug('Failed to store onboarding fact', {
          section,
          key,
          err: (err as Error).message,
        });
      }
    }
  }

  // Mark as committed and completed
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE user_onboarding SET
         facts_committed = true,
         status = 'completed',
         completed_at = NOW(),
         updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );
  } finally {
    client.release();
  }

  return { count };
}

export async function resetOnboarding(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM user_onboarding WHERE user_id = $1', [userId]);
  } finally {
    client.release();
  }
}

export function buildOnboardingPrompt(state: OnboardingState): string {
  const phaseName = state.currentPhase === 1 ? 'Discovery'
    : state.currentPhase === 2 ? 'Business'
    : state.currentPhase === 3 ? 'System'
    : 'Review';

  const sectionLabel = state.currentSection.charAt(0).toUpperCase() + state.currentSection.slice(1);

  // Build progress bar
  const totalSections = ORDERED_SECTIONS.length;
  const completedCount = Object.values(state.sectionStatus)
    .filter(s => s === 'done' || s === 'skipped').length;
  const progressFilled = Math.round((completedCount / totalSections) * 8);
  const progressBar = '='.repeat(progressFilled) + '-'.repeat(8 - progressFilled);

  // Build section trail for progress line
  const sectionTrail = ORDERED_SECTIONS.map(({ section }) => {
    const status = state.sectionStatus[section];
    const isCurrent = section === state.currentSection;
    const label = section.toLowerCase();
    if (isCurrent) return `**${label.toUpperCase()}**`;
    if (status === 'done') return `${label}(done)`;
    if (status === 'skipped') return `${label}(skip)`;
    return label;
  }).join(' > ');

  // Collected data summary (non-empty sections only)
  const collectedSummary: Record<string, Record<string, string>> = {};
  for (const [section, data] of Object.entries(state.collectedData)) {
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      collectedSummary[section] = data;
    }
  }
  const collectedStr = JSON.stringify(collectedSummary);

  const guidance = SECTION_GUIDANCE[state.currentSection] || 'Learn what you can about this topic.';

  return `[Onboarding Interview - Active]
You are getting to know a new user. Be warm, curious, and conversational - not clinical or robotic.
Ask about one topic at a time. Follow up on interesting things they mention. Don't rush through a checklist.

CURRENT: Phase ${state.currentPhase} (${phaseName}) - Section: ${state.currentSection}
ALREADY COLLECTED: ${collectedStr}

SECTION GUIDANCE - ${sectionLabel}:
${guidance}

After each response, append a hidden data block on its own line:
<!--onboarding:{"section":"${state.currentSection}","data":{"key":"value"},"advance":false}-->
Set "advance":true when the section feels naturally covered.
If the user says "skip" or wants to move on: {"section":"${state.currentSection}","data":{},"advance":true,"skip":true}

PROGRESS: [${progressBar}] ${sectionTrail}`;
}

export async function processAssistantResponse(userId: string, content: string): Promise<void> {
  // Regex to find all onboarding data blocks (there may be multiple or zero)
  const blockRegex = /<!--onboarding:(\{.*?\})-->/gs;
  const matches = [...content.matchAll(blockRegex)];

  if (matches.length === 0) return;

  for (const match of matches) {
    try {
      const raw = match[1];
      const parsed = JSON.parse(raw) as {
        section?: string;
        data?: Record<string, string>;
        advance?: boolean;
        skip?: boolean;
      };

      if (!parsed.section || typeof parsed.section !== 'string') continue;
      if (!parsed.data || typeof parsed.data !== 'object') continue;

      // Store collected data if non-empty
      const dataKeys = Object.keys(parsed.data);
      if (dataKeys.length > 0) {
        await updateCollectedData(userId, parsed.section, parsed.data);
      }

      // Advance or skip section if flagged
      if (parsed.advance === true) {
        if (parsed.skip === true) {
          await skipSection(userId, parsed.section);
        } else {
          await advanceSection(userId);
        }
      }
    } catch (err) {
      logger.debug('Failed to parse onboarding block', {
        err: (err as Error).message,
        match: match[0].slice(0, 120),
      });
    }
  }
}

// Re-export getUserFacts for use in chat.service.ts integration point
export { getUserFacts };
