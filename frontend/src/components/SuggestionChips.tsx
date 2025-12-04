'use client';

interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

export function SuggestionChips({ suggestions, onSelect }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 py-3 px-4 justify-center">
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => onSelect(suggestion)}
          className="px-4 py-2 rounded-full bg-theme-bg-tertiary hover:bg-theme-accent-primary/20
                     text-theme-text-secondary hover:text-theme-text-primary text-sm transition-colors
                     border border-theme-border hover:border-theme-accent-primary/50"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

export default SuggestionChips;
