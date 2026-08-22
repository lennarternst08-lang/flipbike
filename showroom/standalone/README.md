# Showroom als eigenständige Website

Dieser Ordner macht aus dem Showroom eine eigene Verkaufs-Website. Sie zeigt
ausschließlich die Käufer-Ansicht: Übersicht der Räder, Detailseite mit
beschrifteten Bildern, Kontaktformular und die rechtlichen Seiten. Die
Verkäufer-Ansicht (Anzeigen anlegen, Posteingang, Profil) bleibt in der App und
ist auf der Website gar nicht erst enthalten.

Der Ordner `showroom/` ist bewusst so gebaut, dass er ohne den Rest des Projekts
funktioniert. Er importiert nichts aus `src/`.

## Dateien in diesem Ordner

| Datei                          | Wofür                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| `index.html`                   | Das HTML-Gerüst, Titel und Vorschautexte für geteilte Links   |
| `main.tsx`                     | Startet die Seite und lädt `showroom-data.json`               |
| `styles.css`                   | Lädt Tailwind und lässt den Showroom die volle Seite füllen   |
| `vite.config.ts`               | Bauplan: Wurzel, relative Pfade, Ausgabeordner `dist`         |
| `package.json`                 | Abhängigkeiten und die Befehle `dev`, `build`, `preview`      |
| `showroom-data.example.json`   | Beispieldaten zum Ausprobieren, ohne echte Angaben            |

Das Aussehen selbst steckt in `../theme.css`, die Komponenten in
`../components/`. Diese Dateien werden hier nur eingebunden, nicht kopiert.

## Schritt für Schritt

### 1. Ordner kopieren

Den kompletten Ordner `showroom/` (nicht nur `standalone/`) in ein leeres
Verzeichnis oder ein neues Repository kopieren. Die Struktur muss erhalten
bleiben, sonst finden die Importe aus `standalone/` die Komponenten nicht:

```
showroom/
  types.ts
  theme.css
  config/
  lib/
  components/
  standalone/     <- hier wird gearbeitet
```

### 2. Abhängigkeiten installieren

Alle Befehle laufen **innerhalb von `showroom/standalone`**. Der Bauplan
arbeitet mit relativen Pfaden und geht davon aus, dass dieser Ordner die Wurzel
des Projekts ist.

```
cd showroom/standalone
npm install
```

### 3. Ansehen

```
npm run dev
```

Vite nennt eine Adresse, meist <http://localhost:5173>. Zum Ausprobieren ohne
eigene Daten reicht:

```
cp showroom-data.example.json showroom-data.json
```

(unter Windows: `copy showroom-data.example.json showroom-data.json`)

Die Seite lädt die Datei beim Start neu; nach dem Kopieren also einmal die
Seite aktualisieren.

### 4. Eigene Daten exportieren

In der Werkstatt-App: Reiter **Showroom** öffnen, Verkäufer-Ansicht, dort
**Profil** und dann **Website-Daten exportieren**. Der Browser lädt eine Datei
namens `showroom-data.json` herunter. Diese Datei nach `showroom/standalone/`
legen, direkt neben die `index.html`.

Wichtig zu wissen:

- Exportiert werden nur Anzeigen, die **nicht** den Status "Entwurf" haben.
- Die Datei enthält die Impressumsangaben aus dem Profil. Sie gehört damit auf
  die Website, aber **nicht** in ein öffentliches Repository, solange dort echte
  Daten drinstehen. Am einfachsten: `showroom-data.json` in die `.gitignore`
  aufnehmen und die Datei erst beim Hochladen dazulegen.
- Fehlt die Datei oder ist sie kaputt, startet die Seite trotzdem und blendet
  oben einen Hinweis ein. Sie zeigt dann die Anzeigen aus dem Browser-Speicher,
  auf einem fremden Rechner also gar keine.

### 5. Bauen

```
npm run build
```

Das Ergebnis liegt in `showroom/standalone/dist`. Mit

```
npm run preview
```

lässt sich das gebaute Ergebnis noch einmal lokal ansehen, bevor es hochgeht.

### 6. Hochladen

Der Inhalt von `dist` ist eine reine statische Website: HTML, CSS, JavaScript,
sonst nichts. Ein Server mit PHP oder Datenbank ist nicht nötig.

- **Webspace (FTP):** den Inhalt von `dist` in das Zielverzeichnis kopieren.
  `showroom-data.json` nicht vergessen – sie wird von `dist` mitkopiert, wenn
  sie beim Bauen im Ordner lag.
- **GitHub Pages:** `dist` in den Branch `gh-pages` schieben oder in den Ordner
  `docs/` des Hauptbranches legen und Pages darauf zeigen lassen. Da `base` auf
  `'./'` steht, funktioniert die Seite auch unter `benutzername.github.io/repo/`.
- **Netlify:** Ordner `dist` per Drag-and-drop hochladen. Oder das Repository
  verbinden mit Basisverzeichnis `showroom/standalone`, Build-Befehl
  `npm run build`, Veröffentlichungsverzeichnis `dist`.

Geteilte Links auf einzelne Räder haben die Form
`https://deine-domain.de/#/rad/<slug>`. Damit die App diese Adresse beim Teilen
erzeugt, im Profil unter Einstellungen die öffentliche Adresse eintragen.

## Kontaktformular anbinden

Ohne weitere Einstellung landet eine Anfrage nur im Browser des Interessenten –
das reicht zum Ausprobieren, aber nicht für den Betrieb. Es gibt drei Wege, die
in der App unter Profil eingestellt werden und im Export mitwandern:

| Einstellung | Was passiert                                                                     |
| ----------- | -------------------------------------------------------------------------------- |
| `lokal`     | Anfrage bleibt im Browser des Absenders. Nur zum Testen.                          |
| `mailto`    | Das Mailprogramm des Interessenten öffnet sich mit fertigem Text. Kein Server nötig. |
| `http`      | Die Website schickt die Anfrage an einen Endpunkt, den Posteingang holt sie ab.   |

`mailto` ist für den Anfang die ehrlichste Lösung: nichts kann verloren gehen,
und es ist kein Server zu betreuen. Der Nachteil ist, dass der Absender ein
eingerichtetes Mailprogramm braucht.

### Der Vertrag des Endpunkts (`http`)

Absichtlich winzig gehalten, damit sich fast jeder Dienst davorsetzen lässt.
Wortlaut aus `../lib/inquiries.ts` (`ENDPOINT_CONTRACT`):

```
POST  <endpointUrl>
  Header: Content-Type: application/json, X-Showroom-Key: <optional>
  Body:   { id, listingId, listingTitle, name, email, phone, message,
            offerPrice, createdAt, source }
  Antwort: 2xx = angenommen

GET   <endpointUrl>?since=<timestamp>
  Header: X-Showroom-Key: <optional>
  Antwort: { "inquiries": [ ...gleiche Objekte... ] }  oder direkt ein Array
```

Der `POST` kommt von der Website, der `GET` vom Posteingang der App. `since` ist
ein Zeitstempel in Millisekunden; ein Endpunkt darf ihn auch ignorieren und
immer alles liefern – doppelte Anfragen werden anhand der `id` erkannt und
verworfen.

Schlägt der `POST` fehl, sichert die Website die Anfrage im Browser des
Absenders und meldet das offen. Eine Anfrage geht also nicht verloren, nur weil
der Server gerade nicht erreichbar ist.

### Beispiel für einen minimalen Endpunkt

Node mit Express, Ablage in einer JSON-Datei. Das genügt für ein paar Anfragen
am Tag; sobald es mehr werden, gehört das in eine richtige Datenbank.

```js
import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DATEI = './anfragen.json';
const SCHLUESSEL = process.env.SHOWROOM_KEY; // optional
const app = express();
app.use(express.json({ limit: '64kb' }));

// Die Website liegt auf einer anderen Adresse als der Endpunkt -> CORS erlauben.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', 'https://deine-domain.de');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-Showroom-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const lesen = () => (existsSync(DATEI) ? JSON.parse(readFileSync(DATEI, 'utf8')) : []);

app.post('/anfragen', (req, res) => {
  const alle = lesen();
  if (!alle.some((a) => a.id === req.body.id)) alle.unshift(req.body);
  writeFileSync(DATEI, JSON.stringify(alle, null, 2));
  res.sendStatus(204);
});

app.get('/anfragen', (req, res) => {
  // Der GET liefert die Kontaktdaten von Interessenten - ohne Schluessel nicht.
  if (SCHLUESSEL && req.get('X-Showroom-Key') !== SCHLUESSEL) return res.sendStatus(401);
  const since = Number(req.query.since) || 0;
  res.json({ inquiries: lesen().filter((a) => a.createdAt > since) });
});

app.listen(8080);
```

In der App dann unter Profil eintragen: Übertragungsweg `http`, Endpunkt
`https://dein-server.de/anfragen`, und denselben Schlüssel wie in
`SHOWROOM_KEY`.

Der Schlüssel schützt nur den `GET`. Der `POST` muss offen bleiben, weil er aus
dem Browser jedes Besuchers kommt – alles, was dort im Quelltext stünde, wäre
ohnehin öffentlich. Gegen automatisierten Missbrauch hilft an dieser Stelle eher
eine Begrenzung der Anfragen pro IP-Adresse.

Statt eines eigenen Servers geht auch ein fertiger Formulardienst (Formspree,
Basin und ähnliche), solange er JSON per POST annimmt. Der Posteingang kann die
Anfragen dann meist nicht automatisch abholen; dafür gibt es im Posteingang die
Möglichkeit, eine exportierte JSON-Datei einzulesen.

## Was noch fehlt, bevor die Seite wirklich online geht

Die Seite läuft technisch sofort. Bis sie öffentlich erreichbar sein darf,
fehlen aber noch ein paar Dinge, die nichts mit Programmieren zu tun haben:

1. **Impressum vollständig ausfüllen.** Ein gewerbliches Angebot ohne Impressum
   ist abmahnfähig. Pflicht sind nach § 5 DDG mindestens Name, ladungsfähige
   Anschrift (kein Postfach), E-Mail-Adresse und eine zweite Möglichkeit der
   schnellen Kontaktaufnahme, meist die Telefonnummer. Kommt eine
   Umsatzsteuer-Identifikationsnummer dazu, gehört auch die hinein. Die App
   warnt im Profil, solange Pflichtfelder leer sind.
2. **Datenschutzerklärung prüfen.** Der Text im Ordner ist eine Vorlage, keine
   Rechtsberatung. Er muss zu dem passen, was tatsächlich passiert: Wo liegt die
   Website? Führt der Anbieter Server-Logfiles? Wohin gehen die Daten aus dem
   Kontaktformular? Wird ein fremder Formulardienst benutzt, muss der dort
   genannt werden. Im Zweifel einmal jemanden mit Ahnung darüberschauen lassen.
3. **Widerruf und Gewährleistung.** Beim gewerblichen Verkauf an Verbraucher
   gilt bei Fernabsatz das vierzehntägige Widerrufsrecht und die gesetzliche
   Gewährleistung. Bei reiner Abholung mit Kaufabschluss vor Ort ist die Lage
   anders. Auch das gehört einmal geklärt, bevor die erste Anzeige online geht.
4. **Eigene Domain.** Eine Adresse wie `benutzername.github.io/showroom/` wirkt
   auf Käufer nicht wie ein Laden. Eine Domain kostet wenige Euro im Jahr und
   lässt sich bei GitHub Pages und Netlify direkt hinterlegen. Danach die
   öffentliche Adresse in der App eintragen, damit geteilte Links stimmen.
5. **Bilder verkleinern.** Fotos werden als `data:`-URL in der JSON-Datei
   gespeichert. Ein Handyfoto hat leicht vier Megabyte, und die Datei wird
   komplett geladen, bevor die Seite etwas zeigt. Vor dem Hochladen in der App
   auf etwa 1600 Pixel Kantenlänge verkleinern; zehn Anzeigen mit je fünf
   Bildern sollten zusammen deutlich unter fünf Megabyte bleiben.

Ebenfalls sinnvoll, aber nicht zwingend: ein `og:image` in der `index.html`
hinterlegen, damit geteilte Links eine Bildvorschau bekommen, und ein Favicon.
