import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const nextConfig = require('eslint-config-next/core-web-vitals')
const i18next = require('eslint-plugin-i18next')

const config = [
  {
    ignores: ['.next/**', '.next-*/**', 'playwright-report-phase0/**', 'test-results/**'],
  },
  ...nextConfig,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      // Intentional patterns: hydration guards, form resets on open, time-based init
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // ── Scoped bilingual-floor hard-fail gate (04-08 / D-04) ──────────────────
  // A raw user-facing string literal in JSX text, aria-label, placeholder, or
  // title on a floor-facing surface now fails `npm run lint`. This is scoped
  // to the exact files this plan (04-08) brought to full EN/ES parity, not
  // the whole components/engineering|housekeeping/** or
  // app/(dashboard)/{housekeeping,engineering,tasks,programs}/** tree --
  // several sibling engineering/housekeeping/tasks files predate this phase's
  // i18n work and still contain untranslated floor copy (WorkOrderList.tsx,
  // FailurePredictionSidebar.tsx, EngineeringRoomBoard.tsx,
  // CreateWorkOrderModal.tsx, WorkOrderDetailDrawer.tsx, app/(dashboard)/tasks,
  // components/housekeeping/**). Turning the rule on for those paths today
  // would hard-fail `npm run lint` on pre-existing, unrelated code -- see
  // deferred-items.md for the follow-up hardening pass that closes that gap
  // and widens this glob to the full floor-facing directory set.
  {
    files: [
      'app/(dashboard)/engineering/pm-schedules/page.tsx',
      'components/engineering/PMCompletionModal.tsx',
      'components/engineering/WorkOrderCard.tsx',
      'components/programs/HousekeepingDepthPanels.tsx',
      'components/programs/DeepCleanAreasPanel.tsx',
      'components/programs/InspectionDepthPanel.tsx',
    ],
    ignores: [
      // GM/admin/config/inspector-export/analytics dirs stay English (D-03) --
      // exempt even if a future glob widening would otherwise sweep them in.
      'app/(dashboard)/reports/**',
      'app/(dashboard)/billing/**',
      'app/(dashboard)/settings/**',
      '**/*inspector-export*',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          markupOnly: true,
          'jsx-attributes': { include: ['aria-label', 'placeholder', 'title'] },
        },
      ],
    },
  },
]

export default config
