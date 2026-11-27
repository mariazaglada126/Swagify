import { defineConfig, devices } from '@playwright/test';
// Uses the locally installed Chrome (set CHROME_PATH to override). All /api/request calls are mocked in tests.
const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const gl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
export default defineConfig({
  testDir: './test', testMatch: /.*\.spec\.mjs/, timeout: 90_000, workers: 2, reporter: 'list',
  use: { baseURL: 'http://localhost:4173', launchOptions: { executablePath, args: gl } },
  webServer: { command: 'node serve.mjs', url: 'http://localhost:4173/index.html', reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-390', use: { ...devices['iPhone 13'], browserName: 'chromium', defaultBrowserType: 'chromium' } }
  ]
});
