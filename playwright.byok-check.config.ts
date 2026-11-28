import config from './playwright.config';
export default { ...config, webServer: config.webServer.map(server => ({ ...server, reuseExistingServer: true, command: server.command.includes('--bypass-lock') ? server.command : server.command + ' --bypass-lock' })) };
