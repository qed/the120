export default {content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      colors: {
        ink: '#1B1815',
        cream: '#FAF7F1',
        paper: '#F2ECE0',
        profit: '#1F7A48',
        profitDark: '#17603A',
        one20: '#E0201B',
        sun: '#F2B307',
        stone: '#6B6259',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        hand: ['Caveat', 'cursive'],
      },
      boxShadow: {
        frame: '0 18px 40px -18px rgba(27,24,21,0.35)',
        card: '0 2px 0 0 rgba(27,24,21,0.08)',
      },
    },
  },
}
