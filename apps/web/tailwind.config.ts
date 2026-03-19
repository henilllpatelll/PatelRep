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
        sans: ['var(--font-figtree)', ...defaultTheme.fontFamily.sans],
        mono: ['var(--font-jetbrains-mono)', ...defaultTheme.fontFamily.mono],
      },
      colors: {
        bg:       'var(--color-bg)',
        surface:  'var(--color-surface)',
        surface2: 'var(--color-surface-2)',
        status: {
          inspected:        '#8B5CF6',
          'inspected-text': '#5B21B6',
          'inspected-bg':   '#F5F3FF',
          clean:            '#10B981',
          'clean-text':     '#065F46',
          'clean-bg':       '#ECFDF5',
          'in-progress':    '#3B82F6',
          'in-progress-text': '#1E40AF',
          'in-progress-bg': '#EFF6FF',
          dirty:            '#EF4444',
          'dirty-text':     '#991B1B',
          'dirty-bg':       '#FEF2F2',
          oos:              '#A8A29E',
          'oos-text':       '#57534E',
          'oos-bg':         '#F5F5F4',
          vip:              '#FBBF24',
          'vip-text':       '#78350F',
          'vip-bg':         '#FFFBEB',
        },
        risk: {
          high:   '#ef4444',
          medium: '#f97316',
          low:    '#22c55e',
        },
      },
      spacing: { '13': '52px' },
      boxShadow: {
        'amber-glow': '0 0 12px rgba(251,191,36,0.3)',
        'card': '0 2px 12px rgba(0,0,0,0.04)',
        'card-hover': '0 8px 24px rgba(251,191,36,0.10)',
        'sidebar': '4px 0 24px rgba(251,191,36,0.08)',
      },
    },
  },
  plugins: [],
}

export default config
