// Prueft die Zielgruppen-Einordnung an Faellen, die im Echtlauf danebengingen.
//
//   Aufruf:  node scripts/hausverwaltungen/test-einordnung.mjs
//   Exit 0 = alles korrekt, 1 = mindestens eine Abweichung
//
// Die Logik ist hier bewusst nachgebaut statt importiert: scrape.mjs startet
// beim Import sofort den Lauf. Wer einordnen() dort aendert, aendert es hier mit.

import { KATEGORIEN, BRANCHENFREMD } from './quellen.mjs';
function einordnen(name, osmTag = '') {
  const perName = KATEGORIEN.find((k) => k.muster && k.muster.test(name));
  if (perName) return { kategorie: perName.name, prio: perName.prio };
  if (BRANCHENFREMD.test(name)) return null;
  const perSchwach = KATEGORIEN.find((k) => k.schwach && k.schwach.test(name));
  if (perSchwach) return { kategorie: perSchwach.name, prio: perSchwach.prio };
  const perTag = KATEGORIEN.find((k) => k.tagMuster && k.tagMuster.test(osmTag));
  if (perTag) return { kategorie: perTag.name, prio: perTag.prio };
  return null;
}
const faelle = [
  ['PSD Bank Braunschweig eG', '', 'RAUS'],
  ['Praxis Kerekes, FA für Psychiatrie', '', 'RAUS'],
  ['Kernbeisser VEG', '', 'RAUS'],
  ['Frachtrasch International', '', 'RAUS'],
  ['Energiegenossenschaft Braunschweig eG', '', 'RAUS'],
  ['Braunschweiger Baugenossenschaft eG', '', 'Genossenschaft'],
  ['Handwerker-Wohnungsbau-Genossenschaft eG', '', 'Genossenschaft'],
  ['Vereinigte Wohnungsgenossenschaft eG', '', 'Genossenschaft'],
  ['Bauen + Wohnen eG', '', 'Genossenschaft'],
  ['Nibelungen-Wohnbau-GmbH', '', 'Wohnungsunternehmen'],
  ['diversa Immobilienverwaltung', '', 'Hausverwaltung'],
  ['Studentenwerk OstNiedersachsen', '', 'Studenten-/Wohnheim'],
  ['Irgendwas GmbH', 'property_management', 'Hausverwaltung'],
  ['Irgendwas GmbH', 'apartments', 'Wohnobjekt-Betreiber'],
  ['i.SHOP Feinkost aus Asien', 'supermarket', 'RAUS'],
  // "Nibelungen" ist in Braunschweig ein Platz, kein Firmenkennzeichen
  ['Nibelungen Realschule', '', 'RAUS'],
  ['Sheepersharing - Nibelungenplatz', '', 'RAUS'],
  ['Nibelungen-Wohnbau GmbH', '', 'Wohnungsunternehmen'],
  // office=cooperative meint jede Rechtsform-Genossenschaft, nicht Wohnen
  ['Kernbeisser VEG', 'cooperative', 'RAUS'],
  ['Energiegenossenschaft Braunschweig', 'cooperative', 'RAUS'],
  // "Wohn- und ..." nur bei Bautraegern, nicht bei Pflegeheimen
  ['AWO Wohn- und Pflegeheim Am Inselwall', '', 'Pflege/Senioren'],
  ['Wohn- und Zweckbau Niedersachsen GmbH', '', 'Wohnungsunternehmen'],
  ['Wohn- und Eigenheimbau eG', '', 'Wohnungsunternehmen'],
];
let fehler = 0;
for (const [n, tag, erwartet] of faelle) {
  const r = einordnen(n, tag);
  const ist = r ? r.kategorie : 'RAUS';
  const ok = ist === erwartet;
  if (!ok) fehler++;
  console.log(`${ok ? 'ok  ' : 'FEHL'} ${ist.padEnd(20)} ${n}`);
}
console.log(fehler ? `\n${fehler} von ${faelle.length} Faellen falsch` : `\nalle ${faelle.length} Faelle korrekt`);
process.exit(fehler ? 1 : 0);
