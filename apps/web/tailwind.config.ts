import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        status: {
          dirty: '#ef4444',
          'in-progress': '#3b82f6',
          clean: '#eab308',
          inspected: '#22c55e',
          ooo: '#6b7280',
          pickup: '#a855f7',
        },
        risk: {
          high: '#ef4444',
          medium: '#f97316',
          low: '#22c55e',
        },
      },
    },
  },
  plugins: [],
}

export default config
