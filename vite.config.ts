import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Eingangskorb für den WhatsApp-Scan.
//
// Der Job schreibt gefundene Leads nach leads-inbox.json im Projektstamm; die Flyerkarte
// holt sie unter /__leads-inbox ab. Bewusst als Middleware und NICHT als Datei in public/:
// alles in public/ landet beim Build in dist/ und damit auf den öffentlichen GitHub Pages.
// `apply: 'serve'` sorgt zusätzlich dafür, dass es diese Route im Build gar nicht gibt.
function leadsInboxPlugin(): Plugin {
  return {
    name: 'leads-inbox',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__leads-inbox', (_req, res) => {
        const file = path.resolve(__dirname, 'leads-inbox.json');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          res.end('{"leads":[]}');
          return;
        }
        res.end(fs.readFileSync(file, 'utf8'));
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: './',
    plugins: [react(), tailwindcss(), leadsInboxPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
