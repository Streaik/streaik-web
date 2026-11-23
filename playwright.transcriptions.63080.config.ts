import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:15183', actionTimeout: 7_500, locale: 'en-US' },
  webServer: [
    { command: 'npm run dev -w @streaik/sample-byok -- --port 15183', url: 'http://localhost:15183' },
    {
      command: 'npm run dev -w @streaik/sample-entra -- --port 15184', url: 'http://localhost:15184', env: {
        VITE_APP_NAME: 'Northwind & Co',
        VITE_ENTRA_TENANT_ID: '11111111-1111-1111-1111-111111111111',
        VITE_ENTRA_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
        VITE_ENTRA_API_SCOPE: 'api://33333333-3333-3333-3333-333333333333/access_as_user',
      },
    },
  ],
});
