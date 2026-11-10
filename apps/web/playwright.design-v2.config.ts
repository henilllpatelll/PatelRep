import { defineConfig } from '@playwright/test'
import base from './playwright.workflows.config'

// Design V2 is permanent for every hotel: this runs in a real browser against the same hermetic mock backend and
// standalone build as the workflow checks. No preview variable exists any more, so no special build is needed.
//   Build against the mock origin (e2e/hermetic/run.mjs env), then:  npm run test:e2e:design-v2
export default defineConfig({
  ...base,
  testMatch: 'design-v2-permanent-hermetic.spec.ts',
})
