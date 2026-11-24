import { defineConfig, devices } from '@playwright/test';

const testHost = 'dotnet run --project ../streaik-mcp-servers/tests/Streaik.Mcp.TestHost --no-launch-profile';

export default defineConfig({
  testDir: './mcp-tests',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:15273' },
  webServer: [
    { command: `${testHost} --urls http://localhost:15281`, url: 'http://localhost:15281/healthz', timeout: 120_000 },
    { command: `${testHost} --no-build --urls http://localhost:15282 --McpTest:Delegated=true`, url: 'http://localhost:15282/healthz', timeout: 60_000 },
    { command: 'npm run dev -w @streaik/sample-byok -- --port 15273 --strictPort', url: 'http://localhost:15273', env: { VITE_MCP_BASE: 'http://localhost:15281' } },
  ],
});
