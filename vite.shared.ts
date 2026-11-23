import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export function sampleConfig(port: number, defaultTarget: string, defaultAppName: string, redirectBridge = false) {
  return defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), ['STREAIK_', 'VITE_APP_NAME']);
    const appName = env.VITE_APP_NAME?.trim() || defaultAppName;
    const htmlTitle = appName.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return {
      plugins: [react(), {
        name: 'streak-app-title',
        transformIndexHtml: (html) => html.replace('<title><!-- app-name --></title>', () => `<title>${htmlTitle}</title>`),
      }],
      define: { 'import.meta.env.VITE_APP_NAME': JSON.stringify(appName) },
      resolve: { dedupe: ['react', 'react-dom'] },
      // Linked workspace sources and their optimized dependencies must use
      // the same React module, including the dev JSX runtime.
      optimizeDeps: {
        include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', '@ai-sdk/react', 'ai', '@radix-ui/react-select', 'react-i18next'],
      },
      server: {
        host: 'localhost', port, strictPort: true,
        proxy: {
          '^/gateway/': {
            target: env.STREAIK_GATEWAY_TARGET || defaultTarget,
            changeOrigin: true,
            rewrite: (path) => path.slice('/gateway'.length),
          },
        },
      },
      build: redirectBridge ? { rolldownOptions: { input: ['index.html', 'auth-redirect.html'] } } : {},
    };
  });
}
