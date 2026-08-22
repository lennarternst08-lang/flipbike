# Showroom

Der Showroom ist der Verkaufsteil des Projekts: Anzeigen für die gebrauchten
Räder anlegen, Bilder beschriften, Anfragen entgegennehmen – und dasselbe
Ganze aus Sicht eines Käufers zeigen.

Er hat zwei Betriebsarten:

1. **Als Reiter in der Werkstatt-App.** Dort stehen beide Perspektiven zur
   Verfügung; die Käufer-Ansicht ist die Vorschau auf das, was später im Netz
   steht. Anzeigen lassen sich aus den Rädern der Werkstatt erzeugen, Fotos und
   Mängel wandern dabei mit.
2. **Als eigenständige Website.** Der Ordner `showroom/` wird als Ganzes in ein
   leeres Repository kopiert und mit dem Bauplan aus `standalone/` gebaut. Die
   Seite zeigt dann nur die Käufer-Ansicht. Siehe
   [standalone/README.md](standalone/README.md).

Beide Betriebsarten benutzen dieselbe Wurzelkomponente
(`components/ShowroomModule.tsx`) und dieselben Daten. Der Unterschied besteht
nur aus zwei Eigenschaften: `lockedPerspective="kaeufer"` und ein
`initialBundle` mit den exportierten Daten.

## Aufbau

```
showroom/
  types.ts              Datenmodell: Anzeige, Hotspot, Anfrage, Profil, Einstellungen
  theme.css             Das komplette Aussehen (.sr-*-Klassen)
  config/
    seller.ts           Voreinstellungen und alle Beschriftungen der Auswahlfelder
  lib/
    listing.ts          Anzeigen erzeugen, aus einem Rad ableiten, filtern, formatieren
    inquiries.ts        Anfragen: prüfen, verschicken, abholen, beantworten
    storage.ts          Ablage im Browser, Export und Import der Website-Daten
    share.ts            Teilen-Links, Zwischenablage, natives Teilen-Menü
    textSuggestions.ts  Vorschläge für Titel, Beschreibung und Kurzantworten
  components/
    ShowroomModule.tsx  Wurzelkomponente, hält den gesamten Zustand
    seller/             Verkäufer: Übersicht, Editor, Bildbeschriftung, Posteingang, Profil
    buyer/              Käufer: Ladenansicht, Anzeigenseite, Bilder, Formular, Rechtstexte
  standalone/           Bauplan und Einstiegspunkt der eigenständigen Website
```

Die Aufteilung folgt einer einfachen Regel: `lib/` enthält nur Logik ohne React,
`components/` nur Darstellung. Alles, was ohne Bildschirm nachvollziehbar sein
soll – Preisformatierung, Filter, der Weg einer Anfrage – gehört nach `lib/`.

## Regeln für diesen Ordner

Diese drei Punkte sind der Grund, warum der Ordner so aussieht, wie er aussieht.
Wer hier etwas ergänzt, sollte sie kennen:

1. **Keine Importe aus `src/`.** Sonst lässt sich der Ordner nicht mehr
   herauskopieren. Ein Rad der Haupt-App wird nur über den strukturellen Typ
   `BikeLike` aus `lib/listing.ts` angefasst: er beschreibt den Ausschnitt, den
   der Showroom braucht, und `Bike` aus `src/types.ts` erfüllt ihn, ohne dass
   eine der beiden Seiten die andere kennen muss.
2. **Keine echten Personendaten im Quellcode.** Der Build dieses Projekts landet
   auf öffentlichen GitHub Pages. Name, Anschrift, Telefonnummer und E-Mail
   stehen deshalb nirgends im Code, sondern kommen zur Laufzeit aus dem
   Verkäufer-Profil. `config/seller.ts` enthält nur Platzhalter und ohnehin
   öffentliche Angaben.
3. **Keine neuen Abhängigkeiten.** Erlaubt sind `react`, `lucide-react` und der
   Inhalt dieses Ordners. Jedes weitere Paket müsste die eigenständige Website
   ebenfalls installieren – und macht die Behauptung, der Ordner sei
   eigenständig, ein Stück weit unwahr.

Dazu kommt das Aussehen: der Showroom sieht bewusst anders aus als der Rest der
App. Farben, Flächen, Knöpfe und Eingabefelder kommen aus den `.sr-*`-Klassen in
`theme.css`, nicht aus Tailwind-Farbklassen. Tailwind wird nur für Layout und
Abstände benutzt. Wer eine Farbe direkt braucht, nimmt die CSS-Variablen
(`var(--sr-text)`, `var(--sr-muted)`, `var(--sr-accent)` und so weiter). Die
Akzentfarbe setzt die Wurzelkomponente zur Laufzeit aus dem Profil.

## Wo liegen die Daten

Der Showroom speichert im **localStorage** des Browsers, unter diesen
Schlüsseln (definiert in `lib/storage.ts`):

| Schlüssel             | Inhalt                                          |
| --------------------- | ----------------------------------------------- |
| `showroom_listings`   | Alle Anzeigen, auch Entwürfe                     |
| `showroom_inquiries`  | Posteingang, höchstens 500 Einträge              |
| `showroom_profile`    | Verkäufer-Stammdaten und Impressumsangaben       |
| `showroom_settings`   | Übertragungsweg, Endpunkt, öffentliche Adresse   |
| `showroom_favorites`  | Merkliste der Käufer-Ansicht                     |

Warum kein Firestore: die Sicherheitsregeln dieses Projekts lassen sich nicht
neu ausrollen (kein Firebase-CLI vorhanden). Eine neue Sammlung
`showroomListings` würde deshalb von den bestehenden Regeln abgelehnt.

Eine Anzeige, die zu einem Rad der Werkstatt gehört, wird zusätzlich in das
**Fahrrad-Dokument** gespiegelt: die Haupt-App reicht dazu ihr `updateBike` als
`onPersistListingToBike` durch. Das funktioniert, weil `isValidBike` in den
Regeln mit `hasAll` prüft und Zusatzfelder am Fahrrad-Dokument damit erlaubt
sind. `listingForBikeDoc` entfernt vorher die Bilder: sie liegen bereits in
`bike.photos`, und ein Dokument darf bei Firestore nicht größer als ein Megabyte
werden. Anzeigen zu einem Rad referenzieren die Fotos deshalb nur über
`photoIndices` – aufgelöst wird das immer über `listingPhotos(listing, bike)`,
nie über `listing.photos` direkt.

Für die eigenständige Website gibt es einen dritten Ablageort: die Datei
`showroom-data.json`. Sie entsteht in der App über "Website-Daten exportieren"
(`buildBundle`) und enthält Profil, Einstellungen und alle Anzeigen außer den
Entwürfen. Die Website lädt sie beim Start und rührt den Browser-Speicher dann
gar nicht mehr an.

## Nächste Ausbaustufen

Drei Dinge sind vorbereitet, aber bewusst noch nicht gebaut:

- **Textvorschläge über ein Sprachmodell.** `lib/textSuggestions.ts` arbeitet
  regelbasiert, also ohne Netz und ohne Schlüssel – das funktioniert sofort und
  auch offline. Die Schnittstelle `SuggestionEngine` ist aber schon da: eine
  LLM-Variante muss nur `describe` und `title` erfüllen und einmal per
  `setSuggestionEngine` eingehängt werden. Kein Aufrufer im Editor ändert sich
  dadurch. Das Projekt hat `@google/genai` bereits als Abhängigkeit; für die
  eigenständige Website wäre das allerdings eine neue Abhängigkeit und ein
  API-Schlüssel im Browser – der Vorschlag gehört deshalb in die App, nicht auf
  die Website.
- **Echtes 3D statt Drehteller.** Der Drehteller (`TurntableConfig`,
  `TurntableViewer`) blättert nur schnell durch vorhandene Fotos. Das ist
  ehrlich und kostet nichts. Ein echtes Modell aus mehreren Aufnahmen
  (Photogrammetrie, Ausgabe als glTF) wäre der nächste Schritt, braucht aber
  einen Betrachter und damit eine weitere Abhängigkeit.
- **Zahlungsabwicklung.** Aktuell endet die Website bei der Anfrage; bezahlt
  wird bei der Abholung. Anzahlung oder Direktkauf würden einen Zahlungsanbieter
  und einen Server erfordern – und damit auch Widerrufsbelehrung, AGB und
  Kaufvertrag in verbindlicher Form. Das Datenmodell ist darauf vorbereitet
  (`delivery`, `shippingCost`, `reservedFor`), die Abwicklung selbst nicht.
