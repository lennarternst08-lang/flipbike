# Tageslauf: WhatsApp + Betrieb

Anleitung für den geplanten Claude-Job (`scripts/tageslauf.bat`, Windows-Aufgabe
**FlipBike-Tageslauf**). Er läuft einmal am Abend und hält fest, was sich seit dem
letzten Lauf geändert hat. Zwei Ergebnisse:

1. `leads-inbox.json` – neue Flyer-Leads aus WhatsApp; die Flyerkarte bietet sie
   im lokalen Dev-Betrieb unter `/__leads-inbox` zum Übernehmen an.
2. `tagesnotiz.md` – der Tagesüberblick mit beiden Themen (früher `whatsapp-zusammenfassung.md`).

> **Alle hier genannten Dateien sind gitignoriert und müssen es bleiben.** Sie enthalten
> Namen und Adressen von Kunden sowie private Unterhaltungen; der Build dieses Projekts
> landet auf öffentlichen GitHub Pages. Niemals Kundendaten in `src/`, `public/` oder in
> Beispieltexte im Code schreiben – auch nicht als Platzhalter in einem Eingabefeld.

Die Aufgabe laeuft taeglich um 20:00 Uhr. Der Batch sagt im Auftrag dazu, welche der beiden Quellen heute etwas hergibt.
Steht dort „nur WhatsApp" oder „nur Betrieb", die andere Datei **gar nicht erst lesen** –
das spart Tokens und verhindert doppelte Einträge.

---

## 1. Quelle A: `whatsapp-neu.md`

Die Nachrichten liegen bereits als Datei bereit. `scripts/whatsapp-dump.mjs` hat sie
direkt aus der Bridge-Datenbank gezogen, bevor dieser Job gestartet wurde.

- **`whatsapp-neu.md` lesen — und nur diese Datei.** Sie enthält den laufenden Tag
  (bzw. mehr, falls der letzte Scan länger zurückliegt). Der Zeitraum steht im Kopf der Datei.
- **`whatsapp-context.md` NICHT lesen.** Das ist der *vollständige* Verlauf über alle
  Jahre – inzwischen mehrere hundert Nachrichten. Sie ist für Rückfragen von Hand
  gedacht, nicht für diesen Lauf, und würde unnötig Tokens kosten.
- Es sind **keine WhatsApp-Tools nötig** und keine erlaubt. Der Job läuft ohne MCP.

Ist `whatsapp-neu.md` leer, nichts tun und das melden.

**Wichtig:** Die Datei kann Nachrichten enthalten, die bereits bei einem früheren Lauf
ausgewertet wurden – sie zeigt bewusst den ganzen Tag. Vor dem Anlegen eines Leads
deshalb immer gegen `leads-inbox.json` prüfen, und in der Tagesnotiz nichts wiederholen,
was im obersten Abschnitt schon steht.

### Leads erkennen

**Inhaltlich lesen, nicht per Regex.** Adressen kommen in freier Form: mit Abkürzungen,
mit Stadtteil statt Postleitzahl, ohne Hausnummer, mitten im Satz, teils erst in einer
Rückfrage mehrere Nachrichten später.

Ein Lead ist eine Nachricht, in der jemand ein Fahrrad abzugeben hat, eine Reparatur
anfragt oder auf den Flyer reagiert – **und** eine Adresse nennt, an der abgeholt werden soll.

Nicht übernehmen:
- Zeilen mit Absender **„Ich"**, in denen die **eigene** Adresse steht
  (Helene-Engelbrecht-Straße 21). Steht in einer gesendeten Nachricht dagegen die Adresse
  des Gegenübers, zählt sie.
- Reine Terminabsprachen ohne Adresse.
- Kontakte, deren Adresse schon in `leads-inbox.json` steht.

Pro Lead festhalten: `address` (Straße + Hausnummer, ausgeschrieben), `name`
(der Absendername aus der Zeile), `note` (Stadtteil, Klingelschild, Preis o. ä.),
`source: "whatsapp"`. **Telefonnummern nicht speichern** – sie werden nicht gebraucht.

### Zusammenführen und schreiben

`leads-inbox.json` lesen, neue Einträge anhängen. Dublettenprüfung über die normalisierte
Adresse (Kleinschreibung, `straße`/`str.` vereinheitlichen, Sonderzeichen entfernen) – die
Karte prüft zusätzlich auf 25 m Abstand, doppelt gemeldete Adressen sind also unkritisch.

Koordinaten sind optional; die Karte geocodiert fehlende Adressen beim Import selbst.
Format:

```json
{ "leads": [ { "address": "…", "name": "…", "note": "…", "source": "whatsapp" } ] }
```

`leads-inbox.state.json` **nicht** anfassen – das erledigt `scripts/whatsapp-mark-scanned.mjs`
nach einem erfolgreichen Lauf. Würde der Stand hier schon fortgeschrieben, gingen bei einem
Abbruch Nachrichten verloren.

---

## 2. Quelle B: `ai-report-neu.md`

Das ist die **fertig ausgerechnete Änderungsliste des Betriebs** – erzeugt von
`scripts/ai-report-diff.mjs`, das den frischen `ai_report` (direkt aus Firestore) mit dem
Stand des letzten Laufs vergleicht. Abschnitte: Kennzahlen, Räder, Arbeitszeit,
Material & Ausgaben, Lager, Flyer, Serviceanfragen, Tages-To-dos, Aktivitätsprotokoll.

- **Nur diese Datei lesen.** `ai-report-latest.json` ist der komplette Datenbestand
  (mehrere hundert KB) – der wird hier nicht gebraucht. Nur öffnen, wenn in der
  Änderungsliste etwas ohne Kontext unverständlich ist.
- Die Zahlen sind bereits richtig gerechnet und formatiert. **Nicht nachrechnen**,
  nur auswählen und in Sätze bringen.
- Steht dort „keine Änderungen", den Abschnitt Betrieb in der Tagesnotiz weglassen.
- Beim allerersten Lauf steht dort eine „Erstaufnahme" statt eines Vergleichs. Dann in
  der Notiz kurz die Ausgangslage festhalten und dazuschreiben, dass ab jetzt nur noch
  Änderungen kommen.

Was in die Notiz gehört (in dieser Reihenfolge der Wichtigkeit):

1. **Verkäufe** – mit Preis und Marge, und wenn erkennbar der Standzeit.
2. **Neue Räder** und Statuswechsel (z. B. „Zu reparieren" → „Inseriert").
3. **Auffällige Kennzahlen** – vor allem Gewinn und Geschäfts-Stundenlohn, aber nur,
   wenn sich spürbar etwas bewegt hat. Kleinkram wie 0,50 € Kapitalverschiebung weglassen.
4. **Flyer-Aktionen** – neue Gebiete mit Anzahl und Zeitaufwand.
5. **Serviceanfragen** – neue Anfragen und erledigte.
6. Arbeitszeit und verbautes Material nur, wenn es etwas erklärt (z. B. warum die Marge
   kleiner ausfiel) oder wenn sonst nichts passiert ist.

Nicht in die Notiz: das rohe Aktivitätsprotokoll, unveränderte Kennzahlen,
Lagerbewegungen von einzelnen Kleinteilen.

---

## 3. Tagesnotiz schreiben

**Oben** in `tagesnotiz.md` einen neuen Abschnitt einfügen (neueste zuerst, Datei anlegen
falls sie fehlt). Zwei Unterabschnitte, je höchstens 6 Zeilen, in normalem Deutsch,
keine Tabellen:

```markdown
## 2026-08-21 20:03

### WhatsApp
- **Hk** bietet zwei Damenräder an, eines geschenkt. Adresse fehlt noch → nachfragen.
- **Raphi** will wegen der Schaltung vorbeikommen, Termin offen.
- Keine neuen Leads für die Karte.

### Betrieb
- **Stevens-Damenrad verkauft** für 150 € – Marge 120 €, 2 h Arbeit drin.
- Kinderrad ist jetzt inseriert (Ziel-VK 90 €), Bremse war das letzte To-do.
- Weststadt beflyert: 120 Flyer in 45 min → Geschäfts-Stundenlohn jetzt 4,60 €/h.
```

Regeln dafür:
- Nur was **handlungsrelevant** ist: neue Angebote, offene Rückfragen, Termine,
  Verkäufe, Statuswechsel, spürbare Kennzahlensprünge.
- Reines Geplauder, Danksagungen und unveränderte Zahlen weglassen.
- Wo etwas von dir zu tun ist, das mit „→" anhängen.
- Telefonnummern nicht aufschreiben.
- Einen Unterabschnitt ganz weglassen, wenn es dazu heute nichts gibt. Ist in **beiden**
  Quellen nichts von Belang, nur eine Zeile: „Nichts Neues von Belang."
- Bestehende Abschnitte **nie** ändern, nur oben ergänzen.

Die Datei ist der Tagesüberblick. Sie wird ins private Repo gepusht und liegt zusätzlich
im Google-Drive-Ordner, wo claude.ai sie live lesen kann.

## 4. Melden

Kurz zurückgeben: wie viele Leads dazugekommen sind und welche, plus in einem Halbsatz
das Wichtigste aus dem Betrieb. Leads werden erst übernommen, wenn in der Flyerkarte auf
**Übernehmen** geklickt wird.

---

## Wenn du das von Hand anstößt

```
node scripts/whatsapp-dump.mjs --force      Nachrichten neu ziehen, Tageswächter übergehen
node --import tsx scripts/ai-report-dump.mts   ai-report-latest.json aus Firestore holen
node scripts/ai-report-diff.mjs             ai-report-neu.md daraus erzeugen
scripts\tageslauf.bat                        alles zusammen, wie die geplante Aufgabe
```

Exit-Codes – `whatsapp-dump.mjs`: `0` = Neues da, `10` = heute schon gelaufen,
`11` = nichts Neues. `ai-report-dump.mts`: `0` = Report da, `12` = kein Dienstkonto
hinterlegt (dann fällt nur der Betriebs-Teil aus). `ai-report-diff.mjs`: `0` = Änderungen,
`11` = alles unverändert.

Der Vergleichsstand (`ai-report-prev.json`) und der WhatsApp-Scanstand rücken **erst nach
einem erfolgreichen Lauf** nach – bricht der Job ab, kommen dieselben Änderungen beim
nächsten Mal wieder ins Delta.

Die Bridge läuft dauerhaft über die Aufgabe **FlipBike-WhatsApp-Bridge** und muss hier
nicht gestartet werden. Kommen gar keine neuen Nachrichten an, prüfen ob sie noch lauscht:
`netstat -ano | grep ":8080.*LISTENING"`.
