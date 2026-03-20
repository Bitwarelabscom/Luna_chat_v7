/**
 * Fact-Semantics Mapping
 *
 * Maps fact keys to semantic types and concept tokens.
 * Used by inline contradiction detection and graph entity enrichment
 * to ground entities with typed metadata (e.g. "Max" is a pet, not just a node).
 */

export interface FactSemantics {
  semanticType: string;
  subType?: string;
  conceptTokens: string[]; // words that indicate the user is talking about this entity
}

export const FACT_KEY_SEMANTICS: Record<string, FactSemantics> = {
  pet_name:     { semanticType: 'pet', conceptTokens: ['pet', 'cat', 'dog', 'animal', 'kitty', 'puppy'] },
  cat_name:     { semanticType: 'pet', subType: 'cat', conceptTokens: ['cat', 'kitten', 'kitty'] },
  dog_name:     { semanticType: 'pet', subType: 'dog', conceptTokens: ['dog', 'puppy'] },
  partner_name: { semanticType: 'person', subType: 'partner', conceptTokens: ['partner', 'wife', 'husband', 'girlfriend', 'boyfriend'] },
  child_name:   { semanticType: 'person', subType: 'child', conceptTokens: ['child', 'kid', 'son', 'daughter'] },
  sibling_name: { semanticType: 'person', subType: 'sibling', conceptTokens: ['brother', 'sister', 'sibling'] },
  parent_name:  { semanticType: 'person', subType: 'parent', conceptTokens: ['mom', 'dad', 'mother', 'father', 'parent'] },
  name:         { semanticType: 'person', conceptTokens: ['name', 'called'] },
  location:     { semanticType: 'place', conceptTokens: ['live', 'city', 'moved', 'town'] },
  company:      { semanticType: 'organization', conceptTokens: ['company', 'employer', 'work'] },
};

/**
 * Get concept tokens for a fact key.
 * Falls back to splitting the key on underscores for unmapped keys.
 */
export function getConceptTokens(factKey: string): string[] {
  const semantics = FACT_KEY_SEMANTICS[factKey];
  return semantics ? semantics.conceptTokens : factKey.split('_');
}
