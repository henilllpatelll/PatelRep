import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['var(--font-sans)',    ...defaultTheme.fontFamily.sans],
        mono:    ['var(--font-mono)',    ...defaultTheme.fontFamily.mono],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      colors: {
        paper:       'var(--paper)',
        surface:     'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        line:        'var(--line)',
        'line-2':    'var(--line-2)',

        ink:         'var(--ink)',
        'ink-2':     'var(--ink-2)',
        'ink-3':     'var(--ink-3)',
        'ink-4':     'var(--ink-4)',

        // short aliases for convenience
        ink2:     'var(--ink-2)',
        ink3:     'var(--ink-3)',
        ink4:     'var(--ink-4)',
        surface2: 'var(--surface-2)',
        surface3: 'var(--surface-3)',
        line2:    'var(--line-2)',

        accent:    'var(--accent)',
        'accent-soft': 'var(--accent-soft)',
        'accent-line': 'var(--accent-line)',

        ready:     'var(--ready)',
        'ready-soft': 'var(--ready-soft)',
        'ready-line': 'var(--ready-line)',

        caution:   'var(--caution)',
        'caution-soft': 'var(--caution-soft)',
        'caution-line': 'var(--caution-line)',

        alert:     'var(--alert)',
        'alert-soft': 'var(--alert-soft)',
        'alert-line': 'var(--alert-line)',

        info:      'var(--info)',
        'info-soft': 'var(--info-soft)',
        'info-line': 'var(--info-line)',

        progress:      'var(--progress)',
        'progress-soft': 'var(--progress-soft)',
        'progress-line': 'var(--progress-line)',

        ai:        'var(--ai)',
        'ai-soft': 'var(--ai-soft)',
        'ai-line': 'var(--ai-line)',

        // legacy compat — used by older components
        bg:       'var(--paper)',
        surface2Old: 'var(--surface-2)',
        status: {
          inspected:          '#0c6e63',
          'inspected-text':   '#0c6e63',
          'inspected-bg':     '#d6eae5',
          clean:              '#265d8a',
          'clean-text':       '#265d8a',
          'clean-bg':         '#d8e6f0',
          'in-progress':      '#7c3aed',
          'in-progress-text': '#7c3aed',
          'in-progress-bg':   '#ede9fe',
          dirty:              '#a6263c',
          'dirty-text':       '#a6263c',
          'dirty-bg':         '#f5d8de',
          oos:                '#b8431c',
          'oos-text':         '#b8431c',
          'oos-bg':           '#fbe9df',
          vip:                '#a16207',
          'vip-text':         '#a16207',
          'vip-bg':           '#f5e9cf',
        },
        risk: {
          high:   '#a6263c',
          medium: '#a16207',
          low:    '#0c6e63',
        },
      },
      spacing: { '13': '52px' },
      boxShadow: {
        sm:          'var(--shadow-sm)',
        card:        'var(--shadow-md)',
        'card-hover':'var(--shadow-lg)',
        pop:         'var(--shadow-pop)',
        sidebar:     'var(--shadow-md)',
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
      },
    },
  },
  plugins: [],
}

export default config
