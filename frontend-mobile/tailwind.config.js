/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        luna: {
          50: '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d6fe',
          300: '#a4b8fc',
          400: '#8093f8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        theme: {
          bg: {
            primary: 'var(--theme-bg-primary)',
            secondary: 'var(--theme-bg-secondary)',
            tertiary: 'var(--theme-bg-tertiary)',
            input: 'var(--theme-bg-input)',
          },
          text: {
            primary: 'var(--theme-text-primary)',
            secondary: 'var(--theme-text-secondary)',
            muted: 'var(--theme-text-muted)',
          },
          border: {
            DEFAULT: 'var(--theme-border)',
            focus: 'var(--theme-border-focus)',
          },
          accent: {
            primary: 'var(--theme-accent-primary)',
            hover: 'var(--theme-accent-hover)',
          },
        },
        terminal: {
          bg: 'var(--terminal-bg)',
          surface: 'var(--terminal-surface)',
          border: 'var(--terminal-border)',
          text: 'var(--terminal-text)',
          muted: 'var(--terminal-text-muted)',
          accent: 'var(--terminal-accent)',
          positive: 'var(--terminal-positive)',
          negative: 'var(--terminal-negative)',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
