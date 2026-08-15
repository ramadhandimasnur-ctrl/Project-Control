import { config as loadEnv } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

/*
 * Next.js reads .env.local by itself, but the Playwright process does not, and
 * the smoke test needs the seed credentials to sign in. Without this the suite
 * skips every test and still exits green — a suite that proves nothing while
 * looking like it passed.
 */
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    /*
     * Its own build directory. Without this the e2e build overwrites the
     * manifest a running `next dev` is serving, and the browser starts 404-ing
     * on chunks that no longer exist — the same collision `build:check` avoids.
     */
    env: { NEXT_DIST_DIR: '.next-e2e' },
  },
});
