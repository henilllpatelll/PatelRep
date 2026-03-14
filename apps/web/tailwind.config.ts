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
        sans: ['Plus Jakarta Sans', ...defaultTheme.fontFamily.sans],
      },
      spacing: {
        '13': '52px',
      },
      backgroundImage: {
        'app-gradient': 'linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 50%, #F5F3FF 100%)',
      },
      colors: {
        // brand-* removed — use indigo-* from Tailwind defaults instead
        status: {
          inspected:    '#4ADE80',
          'inspected-text': '#064E3B',
          clean:        '#99F6E4',
          'clean-text': '#134E4A',
          'in-progress': '#7DD3FC',
          'in-progress-text': '#0C4A6E',
          pickup:       '#DDD6FE',
          'pickup-text': '#5B21B6',
          occupied:     '#FC8D8D',
          'occupied-text': '#7F1D1D',
          dirty:        '#FF4D4D',
          'dirty-text': '#FFFFFF',
          checkout:     '#FF4D4D',
          'checkout-text': '#FFFFFF',
          oos:          '#70767D',
          'oos-text':   '#FFFFFF',
          vip:          '#FCD34D',
          'vip-text':   '#78350F',
        },
        risk: {
          high:   '#ef4444',
          medium: '#f97316',
          low:    '#22c55e',
        },
      },
    },
  },
  plugins: [],
}

export default config
