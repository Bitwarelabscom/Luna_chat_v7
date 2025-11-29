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
        // Theme-aware semantic colors using CSS variables
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
          message: {
            user: 'var(--theme-message-user)',
            assistant: 'var(--theme-message-assistant)',
            'user-text': 'var(--theme-message-user-text)',
            'assistant-text': 'var(--theme-message-assistant-text)',
          },
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        retro: ['VT323', 'monospace'],
      },
      animation: {
        'crt-flicker': 'crt-flicker 0.15s infinite',
        'cursor-blink': 'cursor-blink 1s step-end infinite',
      },
      keyframes: {
        'crt-flicker': {
          '0%, 100%': { opacity: '0.97' },
          '50%': { opacity: '1' },
        },
        'cursor-blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
