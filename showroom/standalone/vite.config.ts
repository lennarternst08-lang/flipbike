import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// ============================================================================
// Bauplan der eigenständigen Website
// ----------------------------------------------------------------------------
// Ein eigenes, kleines Vite-Projekt mit diesem Ordner als Wurzel. Es ist
// absichtlich vom Bauplan der Haupt-App getrennt: `npm run build` im
// Projektstamm baut weiterhin nur die App, dieser Bauplan wird dabei gar nicht
// gelesen. Umgekehrt braucht die Website weder Firebase noch Leaflet.
//
// Alle Pfade sind relativ, `root` ist also das Verzeichnis, aus dem die
// npm-Skripte laufen – und das ist bei `npm run dev` immer der Ordner mit der
// package.json, also dieser hier. Die Befehle deshalb aus `showroom/standalone`
// heraus starten, nicht aus dem Projektstamm.
// ============================================================================

export default defineConfig({
  root: '.',

  // Relative Pfade in der gebauten index.html. Nur so läuft die Seite auch in
  // einem Unterordner, wie ihn GitHub Pages für Projektseiten vergibt.
  base: './',

  plugins: [react(), tailwindcss()],

  build: {
    // Das Ergebnis landet in showroom/standalone/dist. Bewusst innerhalb des
    // Ordners: `showroom/` bleibt so am Stück kopierbar, und `dist/` steht
    // bereits in der .gitignore des Projekts.
    outDir: 'dist',
    emptyOutDir: true,
  },

  server: {
    fs: {
      // Komponenten, Bibliothek und theme.css liegen eine Ebene höher,
      // also außerhalb der Wurzel – ohne diese Freigabe blockt Vite sie ab.
      allow: ['..'],
    },
  },
});
