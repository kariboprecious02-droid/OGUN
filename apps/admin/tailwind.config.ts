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
          accent: '#b44a14', // fill surfaces (white-on-accent) — 5.34:1 AA
          'accent-on-dark': '#e8703a', // text/border on dark bg — 5.76:1 AA min
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
