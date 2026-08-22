# Hausverwaltungen & Co. in Braunschweig

Sammelt alle, die in Braunschweig Häuser mit Fahrradkellern bewirtschaften, in
eine Excel-Liste mit **Name, E-Mail, Telefon, Adresse** – die Basis für die
Anfrage "habt ihr Räder im Keller stehen, die keiner mehr abholt?".

```bash
node scripts/hausverwaltungen/scrape.mjs
```

Ergebnis landet in `hausverwaltungen/` im Projektordner:

| Datei | wofür |
|---|---|
| `hausverwaltungen-braunschweig.xlsx` | die Arbeitsliste, mit Filter und fixierter Kopfzeile |
| `hausverwaltungen-braunschweig.csv`  | dasselbe für Google Sheets oder Serienmail |
| `hausverwaltungen-braunschweig.json` | Rohdaten, hält den Arbeitsstand für den nächsten Lauf |

Die Dateien stehen in `.gitignore`. Das ist Absicht: der Build dieses Projekts
landet auf öffentlichen GitHub Pages, und eine gebündelte Kontaktliste gehört
dort nicht hin.

## Wer alles gesucht wird

"Hausverwaltung" ist nur einer von vielen Namen für dieselbe Zielgruppe. Der
Scraper sucht nach allen davon (Vollständige Liste in `quellen.mjs`):

| Schublade | typische Bezeichnungen | Prio |
|---|---|---|
| **Genossenschaft** | Baugenossenschaft, Wohnungsgenossenschaft, Wohnungsbaugenossenschaft, Siedlungsgenossenschaft, Bauverein, eG | 3 |
| **Wohnungsunternehmen** | Wohnungsbaugesellschaft, Wohnungsunternehmen, Wohnstätten, Wohnbau, Siedlungsgesellschaft, Vonovia, Nibelungen-Wohnbau | 3 |
| **Studenten-/Wohnheim** | Studentenwerk, Studierendenwerk, Studentenwohnheim, Jugendwohnheim, Internat, Gemeinschaftsunterkunft | 3 |
| **Hausverwaltung** | Hausverwaltung, Immobilienverwaltung, Wohnungsverwaltung, Mietverwaltung, Objektverwaltung, WEG-Verwaltung, Sondereigentumsverwaltung, Liegenschaftsverwaltung, Property Management | 3 |
| **Wohnobjekt-Betreiber** | steht in der Karte als Betreiber eines Wohnblocks, ohne dass der Name die Branche verrät | 3 |
| **Pflege/Senioren** | Seniorenheim, Seniorenresidenz, Altenheim, Pflegeheim, Wohnstift, Betreutes Wohnen | 2 |
| **Kirche/Sozialträger** | Diakonie, Caritas, AWO, Kirchengemeinde, Propstei, DRK, Johanniter | 2 |
| **Facility/Hausmeister** | Facility Management, Gebäudemanagement, Hausmeisterservice, Gebäudeservice | 2 |
| **Verwaltung/Grundbesitz** | Verwaltungsgesellschaft, Grundbesitz, Grundstücksverwaltung | 2 |
| **Makler/Immobilien** | Immobilienbüros, Makler – haben oft eine Verwaltungssparte | 1 |

Die Prio-Spalte ist eine Schätzung, wie viele verwaiste Räder dort zu erwarten
sind. Sortiert wird danach: Genossenschaften und Wohnheime stehen oben, Makler
unten.

## Woher die Daten kommen

1. **OpenStreetMap über Overpass** – alles im Stadtgebiet, das entweder ein
   passendes Tag trägt (`office=property_management`, `office=housing_association`,
   `building=dormitory` …) oder dessen **Name** einen der Suchbegriffe
   enthält. Dazu Wohnblocks mit `operator`-Tag: das liefert die Namen der
   Eigentümer ganzer Siedlungen.
2. **Nominatim** – Freitextsuche je Suchbegriff, findet Firmen, deren OSM-Tag
   nicht in unserer Liste steht. Läuft mit 1 Anfrage/Sekunde, wie es die
   Nutzungsbedingungen verlangen.
3. **Kuratierte Liste** – die offizielle Aufstellung der Wohnungsunternehmen
   von braunschweig.de, plus das Studentenwerk. Steht in `quellen.mjs`.
4. **Impressum-Schritt** – zu jeder gefundenen Website werden Startseite,
   Impressum und Kontaktseite gelesen und Telefon + E-Mail herausgezogen.
   Das ist der Teil, der die Liste überhaupt anschreibbar macht: in
   OpenStreetMap steht fast nie eine E-Mail.

Dubletten werden über Domain und normalisierten Firmennamen zusammengeführt,
wobei sich die Quellen gegenseitig ergänzen (Adresse aus der Karte, E-Mail aus
dem Impressum).

Zum Schluss läuft ein **Relevanzfilter**: Die Namenssuche in OpenStreetMap
zieht über `operator`-Tags auch Läden, Kitas und Kulturstiftungen herein. Wer
in keine der Schubladen oben passt, fliegt wieder raus – nur die von Hand
gepflegten Adressen bleiben in jedem Fall stehen.

## Optionen

```bash
--stadt "Wolfenbüttel"   # andere Stadt (die kuratierte Liste gilt nur für Braunschweig)
--ohne-impressum         # nur Kartendaten, dauert 2 statt 15 Minuten
--limit 20               # Probelauf mit wenigen Einträgen
```

## Einordnung prüfen

```bash
node scripts/hausverwaltungen/test-einordnung.mjs
```

Prüft die Zielgruppen-Schubladen an Fällen, die in echten Läufen danebengingen:
die PSD Bank ist keine Baugenossenschaft, nur weil "eG" hinten steht, und eine
Spedition namens "Frachtrasch **Internat**ional" ist kein Internat. Wer die
Muster in `quellen.mjs` anfasst, sollte das danach laufen lassen.

## Eigene Adressen dazulegen

Wer aus dem Telefonbuch oder von Hand noch Firmen kennt, legt
`hausverwaltungen/eigene-adressen.json` an:

```json
[
  { "name": "Beispiel Hausverwaltung GmbH", "website": "https://beispiel-hv.de", "telefon": "0531 123456" }
]
```

Sie werden wie die kuratierten Seeds behandelt: Kontaktdaten holt der
Impressum-Schritt, Dubletten fliegen raus.

## Arbeitsstand

Die Spalten **"Angeschrieben am"** und **"Notiz"** sind für die Hand gedacht.
Ein erneuter Lauf überschreibt die Tabelle, holt diese beiden Spalten aber aus
der JSON des letzten Laufs zurück – solange die JSON liegen bleibt, geht der
Arbeitsstand nicht verloren.

Wichtig: erst in der **CSV oder JSON** nachtragen, wenn danach nochmal gescrapt
werden soll. Die JSON ist die Quelle für die Übernahme, nicht die XLSX.

## Vor dem ersten Serienmail

Kaltakquise per E-Mail ist auch an Firmen nach § 7 UWG ohne vorherige
Einwilligung angreifbar – im schlimmsten Fall eine Abmahnung. Zwei Dinge
senken das Risiko deutlich:

- **Einzeln statt Serienmail**, mit erkennbarem Bezug zum jeweiligen
  Unternehmen, und nicht mehrfach nachfassen, wenn keine Antwort kommt.
- **Erst anrufen.** Die Telefonspalte ist nicht Beiwerk: ein Anruf beim
  Hausmeister oder der Verwaltung ist rechtlich unproblematischer als die
  Kaltmail und führt bei diesem Anliegen erfahrungsgemäß schneller zum Ziel.

Dazu: Absender mit vollem Namen und Anschrift, ein Satz woher die Adresse
stammt (öffentliches Impressum), und ein deutlicher Hinweis, dass man auf
Wunsch sofort aus der Liste gestrichen wird.
