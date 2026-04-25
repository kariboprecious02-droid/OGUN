import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ogun: {
          bg: '#0b0d12',
          surface: '#141820',
          border: '#1f2430',
          text: '#e6e8ec',
          muted: '#8b90a0',
          accent: '#b44a14', // Ogun (fire, Yoruba) — darkened from #e85d1b for WCAG 4.5:1 w/ white
          success: '#3cb371',
          danger: '#e54c4c',
          warn: '#e5a53c',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['-apple-system', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
