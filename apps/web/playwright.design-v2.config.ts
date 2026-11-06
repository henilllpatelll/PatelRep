import { defineConfig } from '@playwright/test'
import base from './playwright.workflows.config'

// Design V2 per-hotel activation, in a real browser. Same hermetic mock backend and standalone build as the workflow
// checks, but it must be built WITHOUT the development preview flag (the tenant flag is the only switch under test),
// so it is a separate config and never shares a build with workflows-hermetic.spec.ts (which needs the preview).
//   Build first against the mock origin (e2e/hermetic/run.mjs env, no preview flag), then:  npm run test:e2e:design-v2
export default defineConfig({
  ...base,
  testMatch: 'design-v2-activation-hermetic.spec.ts',
})
