// Winziger XLSX-Schreiber - erzeugt eine echte Excel-Datei ohne npm-Pakete.
//
// Eine .xlsx ist nur ein ZIP mit ein paar XML-Dateien drin. Node kann deflate
// (zlib), den ZIP-Rahmen drumherum bauen wir hier von Hand. Das spart eine
// Abhaengigkeit, die sonst nur fuer eine einzige Tabelle im Projekt laege.
//
// Kann bewusst nur, was hier gebraucht wird: ein Blatt, eine fette Kopfzeile,
// Spaltenbreiten, Text- und Zahlenzellen, Autofilter, fixierte Kopfzeile.

import zlib from 'node:zlib';

/** CRC32 - vom ZIP-Format fuer jeden Eintrag verlangt. */
const CRC_TABELLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABELLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

/** Baut ein ZIP aus [{ name, daten:Buffer }] - Store oder Deflate, je nachdem was kleiner ist. */
function zipBauen(eintraege) {
  const lokale = [];
  const verzeichnis = [];
  let versatz = 0;

  for (const eintrag of eintraege) {
    const name = Buffer.from(eintrag.name, 'utf8');
    const roh = eintrag.daten;
    const gepackt = zlib.deflateRawSync(roh, { level: 9 });
    const nutzeDeflate = gepackt.length < roh.length;
    const inhalt = nutzeDeflate ? gepackt : roh;
    const methode = nutzeDeflate ? 8 : 0;
    const pruefsumme = crc32(roh);

    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0);   // Signatur
    kopf.writeUInt16LE(20, 4);           // benoetigte Version
    kopf.writeUInt16LE(0x0800, 6);       // Flags: Dateinamen sind UTF-8
    kopf.writeUInt16LE(methode, 8);
    kopf.writeUInt16LE(0, 10);           // Uhrzeit
    kopf.writeUInt16LE(0x21, 12);        // Datum (1980-01-01, damit Laeufe reproduzierbar bleiben)
    kopf.writeUInt32LE(pruefsumme, 14);
    kopf.writeUInt32LE(inhalt.length, 18);
    kopf.writeUInt32LE(roh.length, 22);
    kopf.writeUInt16LE(name.length, 26);
    kopf.writeUInt16LE(0, 28);           // keine Extrafelder
    lokale.push(kopf, name, inhalt);

    const zentral = Buffer.alloc(46);
    zentral.writeUInt32LE(0x02014b50, 0);
    zentral.writeUInt16LE(20, 4);        // erzeugende Version
    zentral.writeUInt16LE(20, 6);
    zentral.writeUInt16LE(0x0800, 8);
    zentral.writeUInt16LE(methode, 10);
    zentral.writeUInt16LE(0, 12);
    zentral.writeUInt16LE(0x21, 14);
    zentral.writeUInt32LE(pruefsumme, 16);
    zentral.writeUInt32LE(inhalt.length, 20);
    zentral.writeUInt32LE(roh.length, 24);
    zentral.writeUInt16LE(name.length, 28);
    zentral.writeUInt16LE(0, 30);        // Extra
    zentral.writeUInt16LE(0, 32);        // Kommentar
    zentral.writeUInt16LE(0, 34);        // Datentraeger
    zentral.writeUInt16LE(0, 36);        // interne Attribute
    zentral.writeUInt32LE(0, 38);        // externe Attribute
    zentral.writeUInt32LE(versatz, 42);  // Position des lokalen Kopfes
    verzeichnis.push(zentral, name);

    versatz += kopf.length + name.length + inhalt.length;
  }

  const verzeichnisBuffer = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(0, 4);
  ende.writeUInt16LE(0, 6);
  ende.writeUInt16LE(eintraege.length, 8);
  ende.writeUInt16LE(eintraege.length, 10);
  ende.writeUInt32LE(verzeichnisBuffer.length, 12);
  ende.writeUInt32LE(versatz, 16);
  ende.writeUInt16LE(0, 20);

  return Buffer.concat([...lokale, verzeichnisBuffer, ende]);
}

/** Maskiert Text fuer XML und wirft Zeichen raus, die Excel nicht in Zellen erlaubt. */
const xmlText = (wert) =>
  String(wert ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Spaltennummer -> Excel-Buchstabe (1 -> A, 27 -> AA). */
const spaltenName = (n) => {
  let name = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - rest) / 26);
  }
  return name;
};

/**
 * Schreibt eine einblaettrige Excel-Datei.
 *
 * @param {object} p
 * @param {string[]} p.spalten       Kopfzeile
 * @param {Array<Array<string|number|null>>} p.zeilen
 * @param {number[]} [p.breiten]     Spaltenbreiten in Zeichen
 * @param {string} [p.blattName]
 * @returns {Buffer} Inhalt der .xlsx
 */
export function xlsxBauen({ spalten, zeilen, breiten = [], blattName = 'Tabelle1' }) {
  const zelle = (spalte, zeile, wert, stil) => {
    const bezug = `${spaltenName(spalte)}${zeile}`;
    const s = stil ? ` s="${stil}"` : '';
    if (wert === null || wert === undefined || wert === '') return `<c r="${bezug}"${s}/>`;
    if (typeof wert === 'number' && Number.isFinite(wert)) return `<c r="${bezug}"${s}><v>${wert}</v></c>`;
    // inlineStr spart die sharedStrings-Tabelle - bei unseren Datenmengen egal.
    return `<c r="${bezug}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(wert)}</t></is></c>`;
  };

  const kopfXml = `<row r="1">${spalten.map((s, i) => zelle(i + 1, 1, s, 1)).join('')}</row>`;
  const zeilenXml = zeilen
    .map((werte, i) => `<row r="${i + 2}">${spalten.map((_, s) => zelle(s + 1, i + 2, werte[s], 2)).join('')}</row>`)
    .join('');

  const spaltenXml = breiten.length
    ? `<cols>${breiten
        .map((b, i) => `<col min="${i + 1}" max="${i + 1}" width="${b}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const letzte = `${spaltenName(spalten.length)}${zeilen.length + 1}`;

  const blatt = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${letzte}"/><sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${spaltenXml}<sheetData>${kopfXml}${zeilenXml}</sheetData><autoFilter ref="A1:${letzte}"/></worksheet>`;

  // Stil 0 = Standard, 1 = Kopfzeile (fett, grauer Hintergrund), 2 = Inhalt (oben, Umbruch)
  const stile = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Standard" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const dateien = [
    {
      name: '[Content_Types].xml',
      daten: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`, 'utf8'),
    },
    {
      name: '_rels/.rels',
      daten: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`, 'utf8'),
    },
    {
      name: 'xl/workbook.xml',
      daten: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlText(blattName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`, 'utf8'),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      daten: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`, 'utf8'),
    },
    { name: 'xl/styles.xml', daten: Buffer.from(stile, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', daten: Buffer.from(blatt, 'utf8') },
  ];

  return zipBauen(dateien);
}
