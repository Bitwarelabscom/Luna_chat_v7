import { api } from './api/core';

export interface Skill {
  name: string;
  description: string;
  content: string;
  source: 'builtin' | 'workspace';
}

export const BUILTIN_SKILLS: Skill[] = [
  {
    name: 'code-review',
    description: 'Thorough code review mode',
    source: 'builtin',
    content: `You are now in code review mode. For every piece of code shown:
- Identify bugs, logic errors, and edge cases
- Flag security vulnerabilities (injection, auth, data exposure)
- Point out performance issues and unnecessary complexity
- Note readability and maintainability concerns
- Suggest concrete improvements with examples
Be direct and specific. Prioritize critical issues over style nits.`,
  },
  {
    name: 'brainstorm',
    description: 'Creative ideation mode',
    source: 'builtin',
    content: `You are now in brainstorm mode. Generate many diverse ideas without self-censorship.
- Quantity over quality in this phase - aim for 10+ ideas
- Include wild, unconventional ideas alongside practical ones
- Build on each idea briefly rather than dismissing
- Group related ideas, note connections
- Avoid filtering or judging ideas during generation
Only after generating ideas should you briefly highlight the 2-3 most promising ones.`,
  },
  {
    name: 'translate',
    description: 'Translation helper',
    source: 'builtin',
    content: `You are now in translation mode.
- If no target language is specified, ask for it before translating
- Translate accurately, preserving tone and register
- For ambiguous phrases, provide the most natural translation and note alternatives
- Preserve formatting (bullet points, headers, etc.)
- Flag idioms or culturally-specific content that doesn't translate directly`,
  },
  {
    name: 'summarize',
    description: 'Summarization mode',
    source: 'builtin',
    content: `You are now in summarization mode. Create concise, structured summaries:
- Lead with the core point in 1-2 sentences
- Use bullet points for key details
- Preserve critical numbers, names, and dates
- Skip filler, repetition, and tangents
- End with action items or conclusions if present
Target length: 20% of original unless specified otherwise.`,
  },
  {
    name: 'explain-like-5',
    description: 'Simple explanations for complex topics',
    source: 'builtin',
    content: `You are now in ELI5 mode (explain like I'm 5).
- Use simple words a child would understand - no jargon
- Use analogies to everyday objects and experiences
- Keep sentences short and concrete
- Build up from basics before adding complexity
- Use "it's like..." comparisons frequently
- Check understanding by asking if the explanation makes sense`,
  },
];

export async function fetchUserSkills(): Promise<Skill[]> {
  try {
    const result = await api<{ files: string[] }>('/api/workspace/files');
    const skillFiles = (result.files || []).filter((f: string) => f.startsWith('skills/') && f.endsWith('.md'));

    const rawSkills: (Skill | null)[] = await Promise.all(
      skillFiles.map(async (path: string): Promise<Skill | null> => {
        const name = path.replace('skills/', '').replace('.md', '');
        try {
          const content = await api<{ content: string }>(`/api/workspace/files/${path}`);
          return {
            name,
            description: `Workspace skill: ${name}`,
            content: content.content || '',
            source: 'workspace',
          };
        } catch {
          return null;
        }
      })
    );
    const skills: Skill[] = rawSkills.filter((s): s is Skill => s !== null);

    return skills;
  } catch {
    return [];
  }
}

export function getSkillByName(name: string, userSkills: Skill[]): Skill | null {
  const all = [...BUILTIN_SKILLS, ...userSkills];
  return all.find(s => s.name.toLowerCase() === name.toLowerCase()) || null;
}
