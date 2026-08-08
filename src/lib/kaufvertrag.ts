import { Bike, BikeDetails, BikeDefect, BikeUebergabeArt } from '../types';
import { formatCurrency } from './utils';

// Fester Verkäufer-Block (gewerblich) – exakt aus dem Muster-Kaufvertrag.
export const SELLER = {
  name: 'Lennart Benjamin Ernst · Fahrradhandel',
  tagline: 'An- und Verkauf sowie Vermittlung von Fahrrädern',
  street: 'Helene-Engelbrecht-Straße 21',
  city: '38124 Braunschweig',
  address: 'Helene-Engelbrecht-Straße 21, 38124 Braunschweig',
  phone: '0162 7055104',
  // Pflichtangabe für die Widerrufsbelehrung (Empfänger der Widerrufserklärung).
  email: 'lennart.fahrrad@gmail.com',
  taxNote: 'Kleinunternehmer gemäß § 19 UStG',
};

// Vorbelegung des Vertragsschluss-Orts bei Abholung in den Geschäftsräumen.
export const ABHOLUNG_ORT = 'Braunschweig, Helene-Engelbrecht-Straße 21';

// Rücksendekosten müssen konkret beziffert sein – sonst trägt sie der Verkäufer.
// Ein Fahrrad ist nicht paketversandfähig, daher Speditions-Schätzung.
export const DEFAULT_RUECKSENDEKOSTEN = 'geschätzt ca. 60–90 € bei Speditionsversand innerhalb Deutschlands';

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
    ort: ABHOLUNG_ORT,
    datum: '',
    uebergabeArt: 'abholung',
    lieferadresse: '',
    vertragsschlussDatum: '',
    kaeuferEmail: '',
    ruecksendekosten: DEFAULT_RUECKSENDEKOSTEN,
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
  const art: BikeUebergabeArt = d.uebergabeArt === 'lieferung' ? 'lieferung' : 'abholung';
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
    // Bei Abholung ist der Ort fix; leer lassen wir ihn nur bei Lieferung zu.
    ort: s(d.ort) || (art === 'abholung' ? ABHOLUNG_ORT : ''),
    datum: s(d.datum),
    uebergabeArt: art,
    lieferadresse: s(d.lieferadresse),
    vertragsschlussDatum: s(d.vertragsschlussDatum),
    kaeuferEmail: s(d.kaeuferEmail),
    ruecksendekosten: s(d.ruecksendekosten) || DEFAULT_RUECKSENDEKOSTEN,
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

// Pflichtfelder der Lieferungs-Variante: fehlen sie, ist die Widerrufsbelehrung
// unvollständig (→ Frist verlängert sich auf 12 Monate + 14 Tage).
export function missingLieferungFields(d?: BikeDetails | null): string[] {
  const s = sanitizeDetails(d);
  if (s.uebergabeArt !== 'lieferung') return [];
  const missing: string[] = [];
  if (!(s.lieferadresse || '').trim()) missing.push('Lieferadresse');
  if (!(s.vertragsschlussDatum || '').trim()) missing.push('Datum des Vertragsschlusses');
  if (!(s.datum || '').trim()) missing.push('Datum der Übergabe / des Warenerhalts');
  if (!(s.kaeuferEmail || '').trim()) missing.push('E-Mail des Käufers');
  return missing;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// yyyy-mm-dd → dd.mm.yyyy (Datumsfelder kommen aus <input type="date">)
function deDate(v?: string): string {
  const s = (v || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
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
// Abholung → eine Seite. Lieferung → zwei Seiten (S.2 = Widerruf).
export function buildKaufvertragHtml(bike: Bike, detailsInput?: BikeDetails): string {
  const d = sanitizeDetails(detailsInput ?? bike.details);
  const isLieferung = d.uebergabeArt === 'lieferung';

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

  const footer = `
    <div class="footer">
      Zweifach ausgefertigt; jede Partei erhält ein Exemplar. ${esc(SELLER.name)} · ${esc(SELLER.address)} · Tel. ${esc(SELLER.phone)}.
    </div>`;

  // Ziffer 5: Ortsklausel. Bei Abholung wird nur der Ort dokumentiert –
  // bewusst OHNE Behauptung einer Rechtsfolge ("kein Widerrufsrecht").
  const uebergabeKlausel = isLieferung
    ? `<div class="legal">Die Übergabe des Fahrrads erfolgte durch Lieferung an den Käufer${
        (d.lieferadresse || '').trim() ? `, ${esc(d.lieferadresse)}` : ''
      }. Der Vertrag wurde außerhalb der Geschäftsräume des Verkäufers geschlossen. Die Widerrufsbelehrung und das Muster-Widerrufsformular sind diesem Vertrag als Ziffer 6 beigefügt.</div>`
    : `<div class="legal">Der Vertrag wurde in den Geschäftsräumen des Verkäufers, ${esc(SELLER.street)}, ${esc(SELLER.city)}, geschlossen. Die Übergabe des Fahrrads erfolgte dort.</div>`;

  const lieferFelder = isLieferung
    ? `<div class="grid">
        ${field('Lieferadresse (Straße, PLZ, Ort)', esc(d.lieferadresse), { wide: true })}
        ${field('Datum des Vertragsschlusses', esc(deDate(d.vertragsschlussDatum)))}
        ${field('Datum der Übergabe / des Warenerhalts', esc(deDate(d.datum)))}
      </div>`
    : '';

  // Verjährungsverkürzung 2 → 1 Jahr: nur mit ausdrücklicher, GESONDERTER
  // Vereinbarung wirksam (§ 476 Abs. 2 BGB) – daher eigenes Kästchen + Unterschrift.
  const verjaehrungsBox = `
    <div class="consent-box">
      <div class="consent-text">
        <span class="cb">☐</span>
        <span>Mir ist bekannt, dass die gesetzliche Verjährungsfrist für Mängelansprüche zwei Jahre beträgt. Ich stimme ausdrücklich und gesondert zu, dass sie bei diesem gebrauchten Fahrrad auf <strong>ein Jahr ab Übergabe</strong> verkürzt wird.</span>
      </div>
      <div class="consent-sign">
        <div class="slot">Unterschrift Käufer</div>
      </div>
    </div>`;

  // ---- Seite 2: Widerrufsbelehrung (nur bei Lieferung) ----
  const seite2 = !isLieferung ? '' : `
  <div class="sheet page-break">
    <h2 class="first">6. Widerrufsbelehrung</h2>

    <h3>Widerrufsrecht</h3>
    <div class="legal">Sie haben das Recht, binnen <strong>vierzehn Tagen</strong> ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem Sie oder ein von Ihnen benannter Dritter, der nicht der Beförderer ist, das Fahrrad in Besitz genommen haben bzw. hat.</div>
    <div class="legal">Um Ihr Widerrufsrecht auszuüben, müssen Sie uns</div>
    <div class="contact-box">
      <strong>${esc(SELLER.name)}</strong><br />
      ${esc(SELLER.street)}, ${esc(SELLER.city)}<br />
      Telefon: ${esc(SELLER.phone)} · E-Mail: ${esc(SELLER.email)}
    </div>
    <div class="legal">mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist. Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.</div>

    <h3>Folgen des Widerrufs</h3>
    <div class="legal">Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.</div>
    <div class="legal">Wir können die Rückzahlung verweigern, bis wir das Fahrrad wieder zurückerhalten haben oder bis Sie den Nachweis erbracht haben, dass Sie das Fahrrad zurückgesandt haben, je nachdem, welches der frühere Zeitpunkt ist.</div>
    <div class="legal">Sie haben das Fahrrad unverzüglich und in jedem Fall spätestens binnen vierzehn Tagen ab dem Tag, an dem Sie uns über den Widerruf dieses Vertrags unterrichten, an uns zurückzusenden oder zu übergeben. Die Frist ist gewahrt, wenn Sie das Fahrrad vor Ablauf der Frist von vierzehn Tagen absenden.</div>
    <div class="legal"><strong>Rücksendekosten:</strong> Sie tragen die unmittelbaren Kosten der Rücksendung des Fahrrads. Da ein Fahrrad nicht paketversandfähig ist, werden diese Kosten auf <strong>${esc(d.ruecksendekosten)}</strong> geschätzt.</div>
    <div class="legal"><strong>Wertersatz:</strong> Sie müssen für einen etwaigen Wertverlust des Fahrrads nur aufkommen, wenn dieser Wertverlust auf einen zur Prüfung der Beschaffenheit, Eigenschaften und Funktionsweise des Fahrrads nicht notwendigen Umgang mit ihm zurückzuführen ist.</div>

    <h2>Muster-Widerrufsformular</h2>
    <div class="form-note">(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück. Anlage 2 zu Art. 246a EGBGB.)</div>
    <div class="revoke-form">
      <div class="legal">An<br />
        <strong>${esc(SELLER.name)}</strong>, ${esc(SELLER.street)}, ${esc(SELLER.city)}<br />
        E-Mail: ${esc(SELLER.email)}
      </div>
      <div class="legal" style="margin-top:6px">Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf des folgenden Fahrrads:</div>
      <div class="grid">
        ${field('Fahrrad (Marke / Modell / Rahmennummer)', '', { wide: true })}
        ${field('Bestellt am / Vertrag geschlossen am', '')}
        ${field('Erhalten am', '')}
        ${field('Name des/der Verbraucher(s)', '', { wide: true })}
        ${field('Anschrift des/der Verbraucher(s)', '', { wide: true })}
        ${field('Datum', '')}
        ${field('Unterschrift (nur bei Mitteilung auf Papier)', '')}
      </div>
      <div class="form-note">(*) Unzutreffendes streichen.</div>
    </div>

    <div class="consent-box">
      <div class="consent-text">
        <span>Ich habe die Widerrufsbelehrung und das Muster-Widerrufsformular erhalten und zur Kenntnis genommen.</span>
      </div>
      <div class="sign">
        <div class="slot">Ort, Datum</div>
        <div class="slot">Unterschrift Käufer</div>
      </div>
    </div>
    ${footer}
  </div>`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 12mm 14mm; }
  html, body { margin: 0; padding: 0; background: #eceff3; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #14181f; }
  .toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    background: #0f172a; color: #e2e8f0; padding: 10px 16px; font-size: 14px;
  }
  .toolbar button {
    background: #f97316; color: #fff; border: 0; border-radius: 8px;
    padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .toolbar button:hover { background: #ea580c; }
  .toolbar .hint { color: #94a3b8; font-size: 12px; }
  .toolbar .warn { color: #fbbf24; font-size: 12px; font-weight: 600; }
  .sheet {
    background: #fff; color: #14181f;
    width: 210mm; min-height: 297mm; margin: 14px auto; padding: 12mm 14mm;
    box-shadow: 0 4px 24px rgba(0,0,0,.18);
    font-size: 9.6pt; line-height: 1.3;
  }
  h1 { font-size: 15pt; margin: 0; text-align: center; letter-spacing: .2px; }
  .subtitle { text-align: center; font-size: 8.5pt; color: #475569; margin: 2px 0 10px; text-transform: uppercase; letter-spacing: 1px; }
  .seller { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 11px; margin-bottom: 10px; background: #f8fafc; }
  .seller .role { font-size: 7.6pt; text-transform: uppercase; letter-spacing: .6px; color: #64748b; font-weight: 700; }
  .seller .name { font-weight: 700; font-size: 10pt; }
  .seller .line { font-size: 8.6pt; color: #334155; }
  h2 { font-size: 10pt; margin: 11px 0 5px; padding-bottom: 3px; border-bottom: 1.5px solid #14181f; }
  h2.first { margin-top: 0; }
  h3 { font-size: 9.2pt; margin: 9px 0 3px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; }
  .field.wide { grid-column: 1 / -1; }
  .field-label { font-size: 7.4pt; color: #64748b; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 1px; }
  .field-value { min-height: 14px; border-bottom: 1px solid #94a3b8; padding: 1px 2px 2px; font-size: 9.6pt; white-space: pre-wrap; word-break: break-word; }
  .legal { font-size: 8pt; color: #334155; margin: 4px 0; line-height: 1.3; text-align: justify; }
  .maengel { margin: 3px 0 0; padding-left: 17px; }
  .maengel li { min-height: 13px; padding: 1px 0; font-size: 9.4pt; }
  .blank-lines { display: flex; flex-direction: column; gap: 8px; margin-top: 7px; }
  .blank-lines span { display: block; border-bottom: 1px solid #94a3b8; height: 11px; }
  .warranty li { margin-bottom: 2px; }
  .contact-box { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 5px; padding: 6px 10px; margin: 5px 0; font-size: 8.4pt; line-height: 1.4; }
  /* Unterschriftenblöcke dürfen NIE über einen Seitenumbruch reißen (Beweisproblem). */
  .sign, .consent-box, .revoke-form { break-inside: avoid; page-break-inside: avoid; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 26px; }
  .sign .slot { border-top: 1px solid #14181f; padding-top: 4px; font-size: 8.2pt; color: #334155; text-align: center; }
  .consent-box { border: 1.5px solid #14181f; border-radius: 6px; padding: 9px 12px; margin: 12px 0 0; }
  .consent-text { display: flex; gap: 8px; font-size: 8.4pt; line-height: 1.35; color: #14181f; }
  .consent-text .cb { font-size: 12pt; line-height: 1; }
  .consent-sign { margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .consent-sign .slot { border-top: 1px solid #14181f; padding-top: 4px; font-size: 8.2pt; color: #334155; text-align: center; }
  .revoke-form { border: 1.5px dashed #64748b; border-radius: 6px; padding: 10px 12px; margin-top: 4px; }
  .form-note { font-size: 7.6pt; color: #64748b; font-style: italic; margin: 3px 0; }
  .footer { margin-top: 14px; padding-top: 7px; border-top: 1px solid #cbd5e1; font-size: 7.4pt; color: #64748b; text-align: center; }
  .page-break { break-before: page; page-break-before: always; }
  @media print {
    html, body { background: #fff; }
    .toolbar { display: none; }
    .sheet { box-shadow: none; margin: 0; width: auto; min-height: 0; padding: 0; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">🖨️ Drucken / Als PDF speichern</button>
    <span class="warn">Im Druckdialog „Kopf- und Fußzeilen" deaktivieren!</span>
    <span class="hint">${isLieferung ? '2 Seiten (Seite 2 = Widerrufsbelehrung)' : '1 Seite'} · „Als PDF speichern" sichert den Vertrag als Datei.</span>
  </div>

  <div class="sheet">
    <h1>Kaufvertrag über ein gebrauchtes Fahrrad</h1>
    <div class="subtitle">Gewerbliches Angebot${isLieferung ? ' · Lieferung' : ''}</div>

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
      ${field('Telefon', esc(d.kaeuferKontakt))}
      ${field('E-Mail', esc(d.kaeuferEmail))}
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
      <li>Gewerblicher Verkauf, kein Privatkauf-Risiko: Auf das Fahrrad besteht die gesetzliche Gewährleistung von 1 Jahr ab Übergabe (siehe gesonderte Vereinbarung unten).</li>
      <li>Ausgenommen sind normale Verschleißteile, insbesondere Reifen/Schläuche, Bremsbeläge, Kette, Kassette/Ritzel, Schalt- und Bremszüge, Beleuchtungsmittel, Griffe, Sattel und Lager im üblichen Umfang.</li>
      <li>Für die unter Ziffer 2 aufgeführten, bekannten Mängel besteht keine Gewährleistung (§ 442 BGB).</li>
    </ul>

    <h2>5. Übergabe &amp; Unterschriften</h2>
    <div class="grid">
      ${field('Ort des Vertragsschlusses', esc(d.ort))}
      ${field('Datum der Übergabe', esc(deDate(d.datum)))}
    </div>
    ${lieferFelder}
    ${uebergabeKlausel}

    ${verjaehrungsBox}

    <div class="sign">
      <div class="slot">Unterschrift Verkäufer</div>
      <div class="slot">Unterschrift Käufer</div>
    </div>
    ${footer}
  </div>
  ${seite2}
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
