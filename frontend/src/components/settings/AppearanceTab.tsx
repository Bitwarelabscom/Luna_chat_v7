'use client';

import { Monitor, Terminal, Sun, Zap, Snowflake, Palette } from 'lucide-react';
import { useThemeStore, type ThemeType } from '@/lib/theme-store';

const themes: { id: ThemeType; name: string; description: string; icon: typeof Monitor }[] = [
  {
    id: 'dark',
    name: 'Modern Dark',
    description: 'Clean, modern interface with purple accents',
    icon: Monitor,
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Clean light interface for daytime use',
    icon: Sun,
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    description: 'Neon pink and cyan synthwave vibes',
    icon: Zap,
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Arctic bluish color palette',
    icon: Snowflake,
  },
  {
    id: 'solarized',
    name: 'Solarized',
    description: 'Low contrast teal accents, easy on eyes',
    icon: Palette,
  },
  {
    id: 'retro',
    name: 'BBS Terminal',
    description: 'Retro CRT terminal with phosphor green glow',
    icon: Terminal,
  },
];

export default function AppearanceTab() {
  const { theme, crtFlicker, setTheme, setCrtFlicker } = useThemeStore();

  return (
    <div className="space-y-6">
      {/* Theme Selection */}
      <div>
        <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4">
          Theme
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {themes.map((t) => {
            const Icon = t.icon;
            const isActive = theme === t.id;

            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`p-4 rounded-lg border-2 transition text-left ${
                  isActive
                    ? 'border-theme-accent-primary bg-theme-accent-primary/10'
                    : 'border-theme-border hover:border-theme-text-muted'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <Icon className={`w-5 h-5 ${isActive ? 'text-theme-accent-primary' : 'text-theme-text-muted'}`} />
                  <span className={`font-medium ${isActive ? 'text-theme-text-primary' : 'text-theme-text-secondary'}`}>
                    {t.name}
                  </span>
                </div>
                <p className="text-sm text-theme-text-muted">
                  {t.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* CRT Flicker Toggle - Only visible when retro theme is selected */}
      {theme === 'retro' && (
        <div>
          <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4">
            Effects
          </h3>
          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-theme-border hover:border-theme-text-muted transition">
            <input
              type="checkbox"
              checked={crtFlicker}
              onChange={(e) => setCrtFlicker(e.target.checked)}
              className="w-4 h-4 rounded border-theme-border text-theme-accent-primary focus:ring-theme-accent-primary focus:ring-offset-0 bg-theme-bg-tertiary"
            />
            <div>
              <span className="text-theme-text-primary font-medium">CRT Screen Flicker</span>
              <p className="text-sm text-theme-text-muted">
                Adds subtle screen flicker for authentic retro feel
              </p>
            </div>
          </label>
        </div>
      )}

      {/* Theme Preview */}
      <div>
        <h3 className="text-sm font-medium text-theme-text-muted uppercase tracking-wider mb-4">
          Preview
        </h3>
        <div className="p-4 rounded-lg bg-theme-bg-secondary border border-theme-border">
          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="px-4 py-2 rounded-2xl text-sm" style={{
                backgroundColor: 'var(--theme-message-user)',
                color: 'var(--theme-message-user-text)'
              }}>
                Hello Luna!
              </div>
            </div>
            <div className="flex justify-start">
              <div className="px-4 py-2 rounded-2xl text-sm border" style={{
                backgroundColor: 'var(--theme-message-assistant)',
                color: 'var(--theme-message-assistant-text)',
                borderColor: 'var(--theme-border)'
              }}>
                Hi! How can I help you today?
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
