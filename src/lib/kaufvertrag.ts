import { Bike, BikeDetails, BikeDefect } from '../types';
import { formatCurrency } from './utils';

// Fester Verkäufer-Block (gewerblich) – exakt aus dem Muster-Kaufvertrag.
export const SELLER = {
  name: 'Lennart Benjamin Ernst · Fahrradhandel',
  tagline: 'An- und Verkauf sowie Vermittlung von Fahrrädern',
  address: 'Helene-Engelbrecht-Straße 21, 38124 Braunschweig',
  phone: '0162 7055104',
  taxNote: 'Kleinunternehmer gemäß § 19 UStG',
};

// Leeres, vollständig definiertes Detail-Objekt (kein undefined → Firestore-sicher).
export function emptyBikeDetails(): BikeDetails {
  return {
    marke: '',
    modell: '',
    rahmennummer: '',
    laufradgroesse: '',
    rahmenhoehe: '',
    farbe: '',
    gangschaltung: '',
    anzahlGaenge: '',
    baujahr: '',
    zubehoer: '',
    maengel: [],
    kaeuferName: '',
    kaeuferAnschrift: '',
    kaeuferKontakt: '',
    verkaufspreis: '',
    zahlweise: '',
    ort: '',
    datum: '',
  };
}

// Wandelt (evtl. unvollständige) Details in ein sauberes, vollständiges Objekt.
// Entfernt undefined-Werte und filtert leere Mängel weg → sicher für Firestore-Writes.
export function sanitizeDetails(d?: Partial<BikeDetails> | null): BikeDetails {
  const base = emptyBikeDetails();
  if (!d) return base;
  const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const maengel: BikeDefect[] = Array.isArray(d.maengel)
    ? d.maengel
        .filter((m): m is BikeDefect => !!m && typeof m === 'object')
        .map((m) => ({ id: m.id || Math.random().toString(36).slice(2, 9), text: s(m.text) }))
    : [];
  return {
    marke: s(d.marke),
    modell: s(d.modell),
    rahmennummer: s(d.rahmennummer),
    laufradgroesse: s(d.laufradgroesse),
    rahmenhoehe: s(d.rahmenhoehe),
    farbe: s(d.farbe),
    gangschaltung: s(d.gangschaltung),
    anzahlGaenge: s(d.anzahlGaenge),
    baujahr: s(d.baujahr),
    zubehoer: s(d.zubehoer),
    maengel,
    kaeuferName: s(d.kaeuferName),
    kaeuferAnschrift: s(d.kaeuferAnschrift),
    kaeuferKontakt: s(d.kaeuferKontakt),
    verkaufspreis: s(d.verkaufspreis),
    zahlweise: s(d.zahlweise),
    ort: s(d.ort),
    datum: s(d.datum),
  };
}

// Zählt, wie viele der vertragsrelevanten Fahrrad-Felder ausgefüllt sind (für die Übersicht).
export const CONTRACT_BIKE_FIELDS: (keyof BikeDetails)[] = [
  'marke', 'modell', 'rahmennummer', 'laufradgroesse', 'rahmenhoehe',
  'farbe', 'gangschaltung', 'anzahlGaenge', 'baujahr', 'zubehoer',
];

export function detailsCompleteness(d?: BikeDetails | null): { filled: number; total: number } {
  const s = sanitizeDetails(d);
  let filled = CONTRACT_BIKE_FIELDS.filter((k) => String(s[k] || '').trim() !== '').length;
  const total = CONTRACT_BIKE_FIELDS.length + 1; // + Mängel
  if ((s.maengel || []).some((m) => m.text.trim() !== '')) filled += 1;
  return { filled, total };
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Vertrags-Kaufpreis: manueller Wert schlägt sellingPrice/targetSellingPrice.
function contractPrice(bike: Bike, d: BikeDetails): string {
  const manual = (d.verkaufspreis || '').trim();
  if (manual) {
    const n = parseFloat(manual.replace(/[^0-9,.-]/g, '').replace(',', '.'));
    return isNaN(n) ? esc(manual) : esc(formatCurrency(n));
  }
  const fallback = bike.sellingPrice ?? bike.targetSellingPrice ?? null;
  return fallback != null && fallback > 0 ? esc(formatCurrency(fallback)) : '';
}

// Baut das vollständige HTML-Dokument des Kaufvertrags (A4, druckfertig).
export function buildKaufvertragHtml(bike: Bike, detailsInput?: BikeDetails): string {
  const d = sanitizeDetails(detailsInput ?? bike.details);

  const markeModell = [d.marke, d.modell].map((x) => (x || '').trim()).filter(Boolean).join(' ')
    || esc(bike.name || '');
  const gangText = [
    (d.gangschaltung || '').trim(),
    (d.anzahlGaenge || '').trim() ? `${(d.anzahlGaenge || '').trim()} Gänge` : '',
  ].filter(Boolean).join(' · ');

  const preis = contractPrice(bike, d);

  const maengel = (d.maengel || []).map((m) => m.text.trim()).filter(Boolean);
  const maengelHtml = maengel.length
    ? `<ul class="maengel">${maengel.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
    : `<div class="blank-lines"><span></span><span></span><span></span></div>`;

  // Feld mit Label darüber; Wert steht auf einer Linie (leer = handschriftlich ausfüllbar).
  const field = (label: string, value: string, opts: { wide?: boolean } = {}) => `
    <div class="field${opts.wide ? ' wide' : ''}">
      <div class="field-label">${label}</div>
      <div class="field-value">${value || '&nbsp;'}</div>
    </div>`;

  const title = `Kaufvertrag_${(bike.name || 'Fahrrad').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_') || 'Fahrrad'}`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 13mm 15mm; }
  html, body { margin: 0; padding: 0; background: #eceff3; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #14181f; }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    background: #0f172a; color: #e2e8f0; padding: 10px 16px;
    font-size: 14px;
  }
  .toolbar button {
    background: #f97316; color: #fff; border: 0; border-radius: 8px;
    padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .toolbar button:hover { background: #ea580c; }
  .toolbar .hint { color: #94a3b8; font-size: 12px; }
  .sheet {
    background: #fff; color: #14181f;
    width: 210mm; min-height: 297mm; margin: 14px auto; padding: 13mm 15mm;
    box-shadow: 0 4px 24px rgba(0,0,0,.18);
    font-size: 10pt; line-height: 1.32;
  }
  h1 { font-size: 15.5pt; margin: 0; text-align: center; letter-spacing: .2px; }
  .subtitle { text-align: center; font-size: 9pt; color: #475569; margin: 2px 0 12px; text-transform: uppercase; letter-spacing: 1px; }
  .seller {
    border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px;
    background: #f8fafc;
  }
  .seller .role { font-size: 8pt; text-transform: uppercase; letter-spacing: .6px; color: #64748b; font-weight: 700; }
  .seller .name { font-weight: 700; font-size: 10.5pt; }
  .seller .line { font-size: 9pt; color: #334155; }
  h2 { font-size: 10.5pt; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 1.5px solid #14181f; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px 18px; }
  .field.wide { grid-column: 1 / -1; }
  .field-label { font-size: 7.8pt; color: #64748b; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 1px; }
  .field-value { min-height: 15px; border-bottom: 1px solid #94a3b8; padding: 1px 2px 2px; font-size: 10pt; white-space: pre-wrap; word-break: break-word; }
  .legal { font-size: 8.3pt; color: #334155; margin: 5px 0; line-height: 1.3; }
  .maengel { margin: 4px 0 0; padding-left: 18px; }
  .maengel li { min-height: 14px; padding: 1px 0; }
  .blank-lines { display: flex; flex-direction: column; gap: 9px; margin-top: 8px; }
  .blank-lines span { display: block; border-bottom: 1px solid #94a3b8; height: 12px; }
  .warranty li { margin-bottom: 3px; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 34px; }
  .sign .slot { border-top: 1px solid #14181f; padding-top: 4px; font-size: 8.5pt; color: #334155; text-align: center; }
  .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 7.6pt; color: #64748b; text-align: center; }
  @media print {
    html, body { background: #fff; }
    .toolbar { display: none; }
    .sheet { box-shadow: none; margin: 0; width: auto; min-height: 0; padding: 0; }
  }
</style>
</head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.print()">🖨️ Drucken / Als PDF speichern</button>
    <span class="hint">Im Druckdialog „Als PDF speichern" wählen, um den Vertrag als Datei zu sichern.</span>
  </div>
  <div class="sheet">
    <h1>Kaufvertrag über ein gebrauchtes Fahrrad</h1>
    <div class="subtitle">Gewerbliches Angebot</div>

    <div class="seller">
      <div class="role">Verkäufer (gewerblich)</div>
      <div class="name">${esc(SELLER.name)}</div>
      <div class="line">${esc(SELLER.tagline)}</div>
      <div class="line">${esc(SELLER.address)} · Telefon: ${esc(SELLER.phone)}</div>
      <div class="line">${esc(SELLER.taxNote)}</div>
    </div>

    <h2>Käufer</h2>
    <div class="grid">
      ${field('Name, Vorname', esc(d.kaeuferName), { wide: true })}
      ${field('Anschrift (Straße, PLZ, Ort)', esc(d.kaeuferAnschrift), { wide: true })}
      ${field('Telefon / E-Mail', esc(d.kaeuferKontakt), { wide: true })}
    </div>

    <h2>1. Kaufgegenstand (Fahrrad)</h2>
    <div class="grid">
      ${field('Marke / Modell', markeModell, { wide: true })}
      ${field('Rahmennummer', esc(d.rahmennummer))}
      ${field('Laufradgröße (Zoll)', esc(d.laufradgroesse))}
      ${field('Rahmenhöhe / Größe', esc(d.rahmenhoehe))}
      ${field('Farbe', esc(d.farbe))}
      ${field('Gangschaltung / Anzahl Gänge', esc(gangText))}
      ${field('ca. Baujahr', esc(d.baujahr))}
      ${field('Mitverkauftes Zubehör (z. B. Schloss, Beleuchtung, Gepäckträger, Ständer)', esc(d.zubehoer), { wide: true })}
    </div>

    <h2>2. Zustand &amp; bekannte Mängel</h2>
    <div class="legal">Das Fahrrad wird gebraucht verkauft. Die eingetragenen Mängel sind dem Käufer bekannt und bei Vertragsschluss ausdrücklich erklärt; für sie besteht keine Gewährleistung (§ 442 BGB).</div>
    ${maengelHtml}

    <h2>3. Kaufpreis &amp; Zahlung</h2>
    <div class="grid">
      ${field('Kaufpreis (in EUR)', preis)}
      ${field('Zahlweise (bar / Überweisung)', esc(d.zahlweise))}
    </div>
    <div class="legal">Der Kaufpreis ist ein Gesamtpreis. Gemäß § 19 UStG (Kleinunternehmer) wird keine Umsatzsteuer ausgewiesen. Mit vollständiger Zahlung und Übergabe geht das Fahrrad in das Eigentum des Käufers über.</div>

    <h2>4. Gewährleistung</h2>
    <ul class="legal warranty">
      <li>Gewerblicher Verkauf, kein Privatkauf-Risiko: Auf das Fahrrad besteht die gesetzliche Gewährleistung von 1 Jahr ab Übergabe.</li>
      <li>Ausgenommen sind normale Verschleißteile, insbesondere Reifen/Schläuche, Bremsbeläge, Kette, Kassette/Ritzel, Schalt- und Bremszüge, Beleuchtungsmittel, Griffe, Sattel und Lager im üblichen Umfang.</li>
      <li>Für die unter Ziffer 2 aufgeführten, bekannten Mängel besteht keine Gewährleistung (§ 442 BGB).</li>
    </ul>

    <h2>5. Übergabe &amp; Unterschriften</h2>
    <div class="grid">
      ${field('Ort', esc(d.ort))}
      ${field('Datum', esc(d.datum))}
    </div>
    <div class="sign">
      <div class="slot">Unterschrift Verkäufer</div>
      <div class="slot">Unterschrift Käufer</div>
    </div>

    <div class="footer">
      Zweifach ausgefertigt; jede Partei erhält ein Exemplar. ${esc(SELLER.name)} · ${esc(SELLER.address)} · Tel. ${esc(SELLER.phone)}.
    </div>
  </div>
</body>
</html>`;
}

// Öffnet den Kaufvertrag zum Drucken / als PDF speichern.
// 1) Bevorzugt ein eigenes Fenster (schöne Vorschau + Drucken-Button).
// 2) Fällt bei Popup-Blockern auf ein verstecktes iframe zurück (druckt direkt, ohne Popup).
export function openKaufvertragPrint(bike: Bike, details?: BikeDetails): void {
  const html = buildKaufvertragHtml(bike, details);

  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    return;
  }

  printViaIframe(html);
}

// Fallback ohne Popup: verstecktes iframe mit dem Vertrag; der Druckdialog
// (dort auch „Als PDF speichern") wird vom Parent ausgelöst.
function printViaIframe(html: string): void {
  const prev = document.getElementById('kv-print-frame');
  if (prev) prev.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'kv-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden',
  } as CSSStyleDeclaration);

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch (e) { /* ignore */ }
  };
  iframe.onload = doPrint;

  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  // Sicherheitsnetz, falls onload bei document.write nicht feuert:
  setTimeout(doPrint, 700);
}
