-- Migration 118: Fix Orpheus TTS emotion tags in agent_definitions
-- Orpheus TTS uses angle-bracket tags like <laugh>, <sigh>, <gasp>
-- NOT square-bracket tags like [laughs], [sighs], [excited]

-- Fix companion mode: replace square-bracket emotion tags with angle-bracket Orpheus tags
UPDATE agent_definitions
SET prompt_template = REPLACE(prompt_template,
  '[laughs] [chuckles] [sighs] [whispers] [excited] [gasps]',
  '<laugh> <chuckle> <sigh> <cough> <sniffle> <groan> <yawn> <gasp>')
WHERE id = 'companion';

UPDATE agent_definitions
SET prompt_template = REPLACE(prompt_template,
  '"[sighs] That sounds exhausting.',
  '"<sigh> That sounds exhausting.')
WHERE id = 'companion';

-- Fix voice mode: replace old ElevenLabs square-bracket tags with Orpheus angle-bracket tags
UPDATE agent_definitions SET prompt_template = REPLACE(prompt_template,
  'Use these ElevenLabs tags for expressiveness:',
  'Use these Orpheus TTS tags for expressiveness:')
WHERE id = 'voice';

UPDATE agent_definitions SET prompt_template = REPLACE(prompt_template,
  '- [laughs] - light laughter',
  '- <laugh> - light laughter')
WHERE id = 'voice';

UPDATE agent_definitions SET prompt_template = REPLACE(prompt_template,
  '- [sighs] - express concern or relief',
  '- <sigh> - express concern or relief')
WHERE id = 'voice';

UPDATE agent_definitions SET prompt_template = REPLACE(prompt_template,
  '- [excited] - show enthusiasm',
  '- <gasp> - surprise or shock')
WHERE id = 'voice';

UPDATE agent_definitions SET prompt_template = REPLACE(prompt_template,
  '- [whispers] - for secrets or emphasis',
  '- <chuckle> - soft amusement
   - <cough> - clearing throat
   - <sniffle> - emotional moment
   - <groan> - frustration or exasperation
   - <yawn> - tiredness')
WHERE id = 'voice';

UPDATE agent_definitions SET prompt_template = REPLACE(prompt_template,
  'Place in SQUARE BRACKETS',
  'Place in ANGLE BRACKETS')
WHERE id = 'voice';

UPDATE agent_definitions SET prompt_template = REPLACE(prompt_template,
  '"[laughs] That''s a great question!',
  '"<laugh> That''s a great question!')
WHERE id = 'voice';
