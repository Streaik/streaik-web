export const mcpTimeoutRange = { min: 1, max: 60 } as const;
export const defaultMcpPreferences = { formElicitation: true, toolTimeoutMinutes: 5, resetTimeoutOnProgress: true };
export type McpPreferences = typeof defaultMcpPreferences;
