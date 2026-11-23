import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

void broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = 'The sign-in window could not return to Streaik. Close it and try again.';
});
