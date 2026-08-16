# WhatsApp nach neuen Flyer-Leads durchsuchen

Anleitung für den geplanten Claude-Job. Ergebnis ist die Datei `leads-inbox.json`
im Projektstamm, die die Flyerkarte im lokalen Dev-Betrieb unter `/__leads-inbox`
zum Übernehmen anbietet.

> **Beide Dateien sind gitignoriert und müssen es bleiben.** Sie enthalten Namen und
> Adressen von Kunden; der Build dieses Projekts landet auf öffentlichen GitHub Pages.
> Niemals Kundendaten in `src/`, `public/` oder in Beispieltexte im Code schreiben –
> auch nicht als Platzhalter in einem Eingabefeld.

## 1. Bridge sicherstellen

Die WhatsApp-MCP-Tools brauchen die Go-Bridge. Prüfen, ob sie auf Port 8080 lauscht:

```bash
netstat -ano | grep ":8080.*LISTENING"
```

Wenn nichts kommt, starten und rund 15 Sekunden warten (die Bridge holt beim Start
die seit dem letzten Lauf aufgelaufenen Nachrichten nach):

```bash
cmd /c start "" "C:\Users\Hacker.HPGAME.000\Desktop\whatsappkonsole.bat"
```

Beim allerersten Start kann ein QR-Code zum Scannen erscheinen. Passiert das im
Hintergrundlauf, den Job abbrechen und melden – ohne angemeldete Bridge gibt es keine
neuen Nachrichten.

## 2. Zeitraum bestimmen

`leads-inbox.state.json` lesen:

```json
{ "lastScan": "2026-08-16T10:00:00" }
```

Fehlt die Datei, die letzten 90 Tage nehmen.

## 3. Nachrichten holen

`mcp__whatsapp__list_messages` mit `after: <lastScan>`, `sort_by: "oldest"`,
`include_context: false`, `limit: 200`. Bei vollem Ergebnis über `page` weiterblättern.

## 4. Leads erkennen

**Inhaltlich lesen, nicht per Regex.** Adressen kommen in freier Form: mit Abkürzungen,
mit Stadtteil statt Postleitzahl, ohne Hausnummer, mitten im Satz, teils erst in einer
Rückfrage mehrere Nachrichten später.

Ein Lead ist eine Nachricht, in der jemand ein Fahrrad abzugeben hat, eine Reparatur
anfragt oder auf den Flyer reagiert – **und** eine Adresse nennt, an der abgeholt werden soll.

Nicht übernehmen:
- Nachrichten von `is_from_me: 1` mit **eigener** Adresse (Helene-Engelbrecht-Straße 21).
  Steht in einer gesendeten Nachricht dagegen die Adresse des Gegenübers, zählt sie.
- Reine Terminabsprachen ohne Adresse.
- Kontakte, deren Adresse schon in `leads-inbox.json` steht.

Pro Lead festhalten: `address` (Straße + Hausnummer, ausgeschrieben), `name`
(aus `sender_name`), `note` (Stadtteil, Klingelschild, Preis o. ä.), `source: "whatsapp"`.
**Telefonnummern nicht speichern** – sie werden nicht gebraucht.

## 5. Zusammenführen und schreiben

`leads-inbox.json` lesen, neue Einträge anhängen. Dublettenprüfung über die normalisierte
Adresse (Kleinschreibung, `straße`/`str.` vereinheitlichen, Sonderzeichen entfernen) – die
Karte prüft zusätzlich auf 25 m Abstand, doppelt gemeldete Adressen sind also unkritisch.

Koordinaten sind optional; die Karte geocodiert fehlende Adressen beim Import selbst.
Format:

```json
{ "leads": [ { "address": "…", "name": "…", "note": "…", "source": "whatsapp" } ] }
```

Danach `leads-inbox.state.json` mit dem Zeitstempel des Laufs aktualisieren.

## 6. Melden

Kurz zurückgeben, wie viele Leads dazugekommen sind und welche. Übernommen werden sie
erst, wenn in der Flyerkarte (`npm run dev`, angemeldet) auf **Übernehmen** geklickt wird.
