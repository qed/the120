/** The Path — Tailwind theme mapping the design tokens in index.css. */
const hsl = (v) => `hsl(${v})`;

export default {content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Fraunces — the "ceremonial" display serif for celebration + Trail warmth
        display: ['Fraunces', 'Georgia', 'serif'],
        mono: ['Spline Sans Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        hq: {
          canvas: 'hsl(var(--hq-canvas))',
          surface: 'hsl(var(--hq-surface))',
          sunken: 'hsl(var(--hq-surface-sunken))',
          border: 'hsl(var(--hq-border))',
          'border-strong': 'hsl(var(--hq-border-strong))',
          ink: 'hsl(var(--hq-ink))',
          'ink-soft': 'hsl(var(--hq-ink-soft))',
          'ink-muted': 'hsl(var(--hq-ink-muted))',
        },
        trail: {
          canvas: 'hsl(var(--trail-canvas))',
          surface: 'hsl(var(--trail-surface))',
          ink: 'hsl(var(--trail-ink))',
          'ink-soft': 'hsl(var(--trail-ink-soft))',
          mist: 'hsl(var(--trail-mist))',
        },
        phase: {
          sell: 'hsl(var(--phase-sell))',
          build: 'hsl(var(--phase-build))',
          validate: 'hsl(var(--phase-validate))',
          grow: 'hsl(var(--phase-grow))',
          scale: 'hsl(var(--phase-scale))',
        },
        verified: 'hsl(var(--verified))',
        awaiting: 'hsl(var(--awaiting))',
        'not-yet': 'hsl(var(--not-yet))',
        wax: 'hsl(var(--wax))',
        'gold-leaf': 'hsl(var(--gold-leaf))',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        xl: '1rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        hq: '0 1px 2px rgba(30, 24, 16, 0.04), 0 1px 3px rgba(30, 24, 16, 0.06)',
        'hq-lg': '0 4px 12px rgba(30, 24, 16, 0.06), 0 12px 32px rgba(30, 24, 16, 0.08)',
        trail: '0 2px 0 rgba(120, 80, 40, 0.12), 0 8px 24px rgba(120, 80, 40, 0.14)',
      },
    },
  },
  plugins: [],
};
