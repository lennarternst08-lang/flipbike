import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import {readJobFromLocation} from './flyerJob';
import FlyerJobView from './components/FlyerJobView';

const root = createRoot(document.getElementById('root')!);
const job = readJobFromLocation();

// Wird ein Auftrags-Link in ein bereits offenes Fenster eingefügt, ändert sich
// nur der Hash – ohne Neuladen bliebe die falsche Ansicht stehen.
window.addEventListener('hashchange', () => window.location.reload());

if (job) {
  // Austräger-Ansicht: die Haupt-App (und damit Firebase) wird bewusst gar
  // nicht erst geladen – der Auftrag steckt vollständig im Link.
  root.render(
    <StrictMode>
      <FlyerJobView job={job} />
    </StrictMode>,
  );
} else {
  import('./App.tsx').then(({default: App}) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
