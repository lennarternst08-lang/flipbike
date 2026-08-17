# WhatsApp nach neuen Flyer-Leads durchsuchen

Anleitung für den geplanten Claude-Job. Ergebnis ist die Datei `leads-inbox.json`
im Projektstamm, die die Flyerkarte im lokalen Dev-Betrieb unter `/__leads-inbox`
zum Übernehmen anbietet.

> **Alle hier genannten Dateien sind gitignoriert und müssen es bleiben.** Sie enthalten
> Namen und Adressen von Kunden sowie private Unterhaltungen; der Build dieses Projekts
> landet auf öffentlichen GitHub Pages. Niemals Kundendaten in `src/`, `public/` oder in
> Beispieltexte im Code schreiben – auch nicht als Platzhalter in einem Eingabefeld.

## 1. Quelle: `whatsapp-neu.md`

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

## 2. Leads erkennen

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

## 3. Zusammenführen und schreiben

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

## 4. Tagesnotiz schreiben

**Oben** in `whatsapp-zusammenfassung.md` einen neuen Abschnitt einfügen (neueste zuerst,
Datei anlegen falls sie fehlt). Höchstens 6 Zeilen, in normalem Deutsch, keine Tabelle:

```markdown
## 2026-08-16 21:14

- **Hk** bietet zwei Damenräder an, eines geschenkt. Adresse fehlt noch → nachfragen.
- **Raphi** will wegen der Schaltung vorbeikommen, Termin offen.
- Keine neuen Leads für die Karte.
```

Regeln dafür:
- Nur was **handlungsrelevant** ist: neue Angebote, offene Rückfragen, Termine.
- Reines Geplauder und Danksagungen weglassen.
- Wo etwas von dir zu tun ist, das mit „→" anhängen.
- Telefonnummern nicht aufschreiben.
- Ist nichts Relevantes dabei, nur eine Zeile: „Nichts Neues von Belang."

Die Datei ist der Tagesüberblick – sie wird ins private Repo gepusht und ist damit auch
im Claude-Projekt lesbar. Bestehende Abschnitte **nie** ändern, nur oben ergänzen.

## 5. Melden

Kurz zurückgeben, wie viele Leads dazugekommen sind und welche. Übernommen werden sie
erst, wenn in der Flyerkarte auf **Übernehmen** geklickt wird.

---

## Wenn du das von Hand anstößt

`node scripts/whatsapp-dump.mjs --force` erzeugt beide Dateien neu und übergeht den
Tageswächter. Exit-Codes: `0` = Neues da, `10` = heute schon gelaufen, `11` = nichts Neues.

Die Bridge läuft dauerhaft über die Aufgabe **FlipBike-WhatsApp-Bridge** und muss hier
nicht gestartet werden. Kommen gar keine neuen Nachrichten an, prüfen ob sie noch lauscht:
`netstat -ano | grep ":8080.*LISTENING"`.
