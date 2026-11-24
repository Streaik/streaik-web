import { defineConfig, devices } from '@playwright/test';

const testHost = 'dotnet run --project ../streaik-mcp-servers/tests/Streaik.Mcp.TestHost --no-launch-profile';
const registryHost = 'dotnet run --project ../streaik-mcp-registry/samples/Streaik.Mcp.Registry.Sample --no-launch-profile --artifacts-path ../streaik-mcp-registry/obj/playwright';
const mcpBase = 'http://localhost:15281';
const registryUrl = 'http://localhost:15283/v0.1/servers';

export default defineConfig({
  testDir: './mcp-tests',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:15273' },
  webServer: [
    { command: `${testHost} --urls http://localhost:15281`, url: 'http://localhost:15281/healthz', timeout: 120_000 },
    { command: `${testHost} --no-build --urls http://localhost:15282 --McpTest:Delegated=true`, url: 'http://localhost:15282/healthz', timeout: 60_000 },
    { command: `${registryHost} --urls http://localhost:15283 --McpRegistry:DefaultServersBaseUrl=${mcpBase} --McpRegistry:BrowserOrigins:0=http://localhost:15273`,
      url: registryUrl, timeout: 120_000 },
    { command: 'npm run dev -w @streaik/sample-byok -- --port 15273 --strictPort', url: 'http://localhost:15273',
      env: { VITE_MCP_BASE: mcpBase, VITE_MCP_REGISTRY_URL: registryUrl } },
  ],
});
