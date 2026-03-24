/**
 * Fact-Semantics Mapping
 *
 * Maps fact keys to semantic types and concept tokens.
 * Used by inline contradiction detection and graph entity enrichment
 * to ground entities with typed metadata (e.g. "Max" is a pet, not just a node).
 *
 * Concept tokens include both identity words ("cat", "pet") AND activity/association
 * words ("tuna", "feed", "walk") so detection fires on natural usage like
 * "I gave Tim tuna" when the stored pet name is Max.
 */

export interface FactSemantics {
  semanticType: string;
  subType?: string;
  conceptTokens: string[]; // words that indicate the user is talking about this entity
}

// Pet activity/association tokens shared across pet types
const PET_ACTIVITY_TOKENS = [
  'pet', 'animal', 'feed', 'fed', 'gave', 'food', 'treat', 'treats', 'bowl',
  'vet', 'collar', 'toy', 'toys', 'cuddle', 'belly', 'paw', 'paws', 'sleeping',
  'fur', 'fluffy', 'adopted', 'rescue', 'shelter', 'snuggle', 'playful',
];

const CAT_TOKENS = [
  'cat', 'cats', 'kitten', 'kitty', 'meow', 'purr', 'purring', 'litter',
  'scratch', 'scratching', 'catnip', 'mouse', 'yarn', 'tuna', 'whiskers',
  'hiss', 'claw', 'claws', 'feline',
  ...PET_ACTIVITY_TOKENS,
];

const DOG_TOKENS = [
  'dog', 'dogs', 'puppy', 'bark', 'barking', 'fetch', 'walk', 'walked',
  'walking', 'leash', 'bone', 'woof', 'tail', 'sniff', 'canine',
  ...PET_ACTIVITY_TOKENS,
];

const CORE_SEMANTICS: Record<string, FactSemantics> = {
  pet_name:     { semanticType: 'pet', conceptTokens: [...CAT_TOKENS, ...DOG_TOKENS] },
  cat_name:     { semanticType: 'pet', subType: 'cat', conceptTokens: CAT_TOKENS },
  dog_name:     { semanticType: 'pet', subType: 'dog', conceptTokens: DOG_TOKENS },
  partner_name: { semanticType: 'person', subType: 'partner', conceptTokens: [
    'partner', 'wife', 'husband', 'girlfriend', 'boyfriend', 'spouse', 'fiancee',
    'love', 'date', 'dating', 'married', 'wedding', 'anniversary', 'together',
    'relationship', 'couple',
  ]},
  child_name:   { semanticType: 'person', subType: 'child', conceptTokens: [
    'child', 'kid', 'kids', 'son', 'daughter', 'baby', 'toddler',
    'school', 'homework', 'grade', 'birthday', 'bedtime', 'daycare',
  ]},
  sibling_name: { semanticType: 'person', subType: 'sibling', conceptTokens: [
    'brother', 'sister', 'sibling', 'siblings', 'twin',
  ]},
  parent_name:  { semanticType: 'person', subType: 'parent', conceptTokens: [
    'mom', 'dad', 'mother', 'father', 'parent', 'parents', 'mama', 'papa',
    'visit', 'visiting', 'call', 'called', 'phone', 'holiday', 'christmas',
  ]},
  name:         { semanticType: 'person', conceptTokens: ['name', 'called', 'call'] },
  location:     { semanticType: 'place', conceptTokens: [
    'live', 'lives', 'living', 'city', 'moved', 'move', 'town', 'country',
    'address', 'home', 'apartment', 'house',
  ]},
  company:      { semanticType: 'organization', conceptTokens: [
    'company', 'employer', 'work', 'working', 'job', 'office', 'boss', 'hired',
  ]},
  pets:         { semanticType: 'pet', conceptTokens: [...CAT_TOKENS, ...DOG_TOKENS] },
};

/**
 * Normalize a camelCase or mixed-format key to snake_case for lookup.
 * catName -> cat_name, petName -> pet_name, etc.
 */
function toSnakeCase(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Build the full mapping with both original keys and snake_case variants.
 */
function buildSemantics(): Record<string, FactSemantics> {
  const result: Record<string, FactSemantics> = { ...CORE_SEMANTICS };

  // Add camelCase aliases (cat_name is also accessible as catName)
  Array.from(Object.entries(CORE_SEMANTICS)).forEach(([key, value]) => {
    // snake_case -> camelCase: pet_name -> petName
    const camel = key.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
    if (camel !== key) {
      result[camel] = value;
    }
  });

  return result;
}

export const FACT_KEY_SEMANTICS = buildSemantics();

/**
 * Get concept tokens for a fact key.
 * Handles camelCase, snake_case, and unmapped keys.
 */
export function getConceptTokens(factKey: string): string[] {
  // Direct lookup first
  const direct = FACT_KEY_SEMANTICS[factKey];
  if (direct) return direct.conceptTokens;

  // Try snake_case conversion
  const snake = toSnakeCase(factKey);
  const snakeMatch = FACT_KEY_SEMANTICS[snake];
  if (snakeMatch) return snakeMatch.conceptTokens;

  // Fallback: split on _ or camelCase boundaries
  return toSnakeCase(factKey).split('_');
}

/**
 * Get full semantics for a fact key.
 * Returns undefined for unmapped keys.
 */
export function getSemantics(factKey: string): FactSemantics | undefined {
  if (!factKey) return undefined;

  const direct = FACT_KEY_SEMANTICS[factKey];
  if (direct) return direct;

  const snake = toSnakeCase(factKey);
  return FACT_KEY_SEMANTICS[snake];
}
