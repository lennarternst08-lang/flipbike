import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { ShowroomModule } from '../components/ShowroomModule';
import { parseBundle } from '../lib/storage';
import type { ShowroomBundle } from '../types';

// ============================================================================
// Einstieg der eigenständigen Website
// ----------------------------------------------------------------------------
// Dieselbe Wurzelkomponente wie im Reiter der App, nur fest auf die
// Käufer-Ansicht gestellt und mit den Daten aus `showroom-data.json` gefüttert.
// Die Datei wird zur Laufzeit geladen und nicht mit gebaut: so lassen sich neue
// Anzeigen veröffentlichen, indem man eine einzige Datei austauscht – ohne
// npm, ohne Build, ohne diesen Ordner überhaupt anzufassen.
// ============================================================================

const DATA_FILE = 'showroom-data.json';

const MISSING_DATA_HINT =
  'showroom-data.json wurde nicht gefunden. Exportiere die Datei in der App unter ' +
  'Profil → Website-Daten exportieren und lege sie neben die index.html.';

type LoadState =
  | { kind: 'laedt' }
  | { kind: 'daten'; bundle: ShowroomBundle }
  | { kind: 'ohne_daten' };

async function loadBundle(): Promise<ShowroomBundle | null> {
  // Relativ zur aufgerufenen Seite, nicht zum Server-Stamm: GitHub Pages legt
  // Projektseiten unter /<repository>/ ab, ein absoluter Pfad ginge dort ins Leere.
  const url = new URL(DATA_FILE, window.location.href);
  const res = await fetch(url.toString(), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseBundle(await res.text());
}

function Root() {
  const [state, setState] = useState<LoadState>({ kind: 'laedt' });

  useEffect(() => {
    let verworfen = false;
    loadBundle()
      .then((bundle) => {
        if (verworfen) return;
        setState(bundle ? { kind: 'daten', bundle } : { kind: 'ohne_daten' });
      })
      .catch((e) => {
        if (verworfen) return;
        console.warn(`[showroom] ${DATA_FILE} konnte nicht geladen werden`, e);
        setState({ kind: 'ohne_daten' });
      });
    return () => {
      verworfen = true;
    };
  }, []);

  useEffect(() => {
    if (state.kind !== 'daten') return;
    const name = (state.bundle.profile.displayName || '').trim();
    if (name) document.title = name;
  }, [state]);

  if (state.kind === 'laedt') return <Ladeflaeche />;

  return (
    <>
      {state.kind === 'ohne_daten' && <Hinweis text={MISSING_DATA_HINT} />}
      {/*
        Ohne gültige Datei bewusst `null` statt eines leeren Bündels: dann greift
        der Browser-Speicher, und wer die Seite lokal ausprobiert, sieht seine
        zuvor in der App angelegten Anzeigen.
      */}
      <ShowroomModule
        lockedPerspective="kaeufer"
        initialBundle={state.kind === 'daten' ? state.bundle : null}
      />
    </>
  );
}

function Ladeflaeche() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        color: '#6f645c',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: 14,
      }}
    >
      Showroom wird geladen …
    </div>
  );
}

/**
 * Ruhiger Streifen über der Seite. Bewusst mit festen Farbwerten statt der
 * `.sr-*`-Klassen: die Meldung steht außerhalb von `.sr-root`, dort sind die
 * CSS-Variablen des Showrooms noch nicht definiert.
 */
function Hinweis({ text }: { text: string }) {
  return (
    <div
      role="status"
      style={{
        padding: '12px 16px',
        background: '#121010',
        borderBottom: '1px solid rgba(200, 147, 74, 0.45)',
        color: '#a1968c',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: 13,
        lineHeight: 1.6,
        textAlign: 'center',
      }}
    >
      {text}
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
