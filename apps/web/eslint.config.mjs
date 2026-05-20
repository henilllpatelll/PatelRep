import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const nextConfig = require('eslint-config-next/core-web-vitals')

const config = [
  ...nextConfig,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      // Intentional patterns: hydration guards, form resets on open, time-based init
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]

export default config
