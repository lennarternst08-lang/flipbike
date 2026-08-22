// Was gesucht wird und wo - die komplette Zielgruppen-Definition an einer Stelle.
//
// Zielgruppe sind alle, die in Braunschweig Haeuser mit Fahrradkellern
// bewirtschaften. "Hausverwaltung" ist dabei nur einer von vielen Namen:
// Genossenschaften, kommunale Wohnungsunternehmen, Studentenwerke, Pflege-
// und Sozialtraeger, Facility-Dienstleister und Makler mit Verwaltungssparte
// sitzen auf denselben vollgestellten Kellern.

/**
 * Overpass-Spiegel in der Reihenfolge, in der sie probiert werden. Alle
 * fuehren den weltweiten Datenbestand - regionale Spiegel gehoeren hier nicht
 * hinein: sie antworten mit 200 und einer leeren Liste, was wie "in
 * Braunschweig gibt es nichts" aussieht statt wie ein Fehlschlag.
 */
export const OVERPASS_SPIEGEL = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/**
 * OSM-Filter, die eine Firma direkt als Zielgruppe ausweisen. Fertige
 * Overpass-Ausdruecke, weil manche Faelle mehr als ein Tag brauchen.
 *
 * amenity=social_facility ist bewusst auf Wohnformen eingeschraenkt: ohne die
 * Einschraenkung kommen Beratungsstellen, Begegnungsstaetten und Freiwilligen-
 * agenturen mit - Einrichtungen ohne Fahrradkeller.
 */
export const OSM_FILTER = [
  '["office"="property_management"]',                    // Hausverwaltung im engeren Sinn
  '["office"="estate_agent"]',                           // Makler, oft mit Verwaltungssparte
  '["shop"="estate_agent"]',
  '["office"="housing_association"]',                    // Genossenschaft / Wohnungsunternehmen
  '["office"="facility_management"]',
  '["office"="caretaker"]',                              // Hausmeisterdienst
  '["amenity"="nursing_home"]',
  '["amenity"="retirement_home"]',
  '["amenity"="social_facility"]["social_facility"~"^(assisted_living|group_home|nursing_home|residential_home|shelter)$"]',
  '["building"="dormitory"]',                            // Wohnheime, auch ohne Betreibernamen
];

/**
 * Namensbausteine. Wer so heisst, verwaltet mit hoher Wahrscheinlichkeit
 * Wohnraum - egal welches OSM-Tag er traegt. Wird zu einer Regex-Abfrage
 * ueber alle Objekte im Stadtgebiet zusammengesetzt und dient gleichzeitig
 * als Suchbegriffsliste fuer Nominatim.
 *
 * Kein "Stiftung" und kein blankes "Immobilien" als Einzelbegriff: das holt
 * Kulturstiftungen und Ladenlokale herein, ohne einen Adressaten mehr zu
 * finden - die echten Treffer haengen ohnehin an den spezifischen Begriffen.
 */
export const NAMENS_BAUSTEINE = [
  // Verwaltung
  'Hausverwaltung', 'Immobilienverwaltung', 'Wohnungsverwaltung', 'Mietverwaltung',
  'Objektverwaltung', 'Liegenschaftsverwaltung', 'Grundstuecksverwaltung', 'Grundstücksverwaltung',
  'Gebaeudeverwaltung', 'Gebäudeverwaltung', 'WEG-Verwaltung', 'Sondereigentumsverwaltung',
  'Verwaltungsgesellschaft', 'Property Management', 'Facility Management', 'Gebäudemanagement',
  'Hausmeisterservice', 'Hausservice', 'Immobilien GmbH', 'Immobilien KG',
  // Eigentuemer und Bautraeger
  'Baugenossenschaft', 'Wohnungsgenossenschaft', 'Wohnungsbaugenossenschaft', 'Siedlungsgenossenschaft',
  'Wohnungsbau', 'Wohnungsgesellschaft', 'Wohnungsunternehmen', 'Wohnbau', 'Wohnstätten', 'Wohnstaetten',
  'Siedlungsgesellschaft', 'Bauverein', 'Bau- und Siedlung', 'Grundbesitz', 'Wohnungswirtschaft',
  // Grosse Vermieter mit Bestand in Braunschweig
  'Vonovia', 'Deutsche Wohnen', 'Nibelungen-Wohnbau', 'LEG Wohnen',
  // Wohnheime
  'Studentenwerk', 'Studierendenwerk', 'Studentenwohnheim', 'Wohnheim', 'Jugendwohnheim',
  'Azubi-Wohnheim', 'Internat', 'Gemeinschaftsunterkunft', 'Wohnanlage', 'Wohnpark',
  // Pflege, Senioren, Soziales - dort stehen Raeder von Bewohnern und Personal
  'Seniorenheim', 'Seniorenresidenz', 'Seniorenzentrum', 'Altenheim', 'Altenpflegeheim',
  'Pflegeheim', 'Pflegezentrum', 'Wohnstift', 'Betreutes Wohnen', 'Sozialwerk',
  'Diakonie', 'Caritas', 'Arbeiterwohlfahrt', 'Kirchengemeinde',
];

/**
 * Zielgruppen-Schubladen. Das erste passende Muster gewinnt, deshalb stehen
 * die spitzen Faelle oben.
 *
 *   muster  - trifft eindeutig auf den Firmennamen zu, sticht die Branchensperre
 *   schwach - trifft auch zu, unterliegt aber der Branchensperre
 *   tag     - trifft auf die OSM-Tags zu (nur wenn der Name nichts verraet)
 *   prio  - grobe Schaetzung, wie viele verwaiste Raeder dort zu erwarten
 *           sind (3 = viele Keller, 1 = eher wenig)
 *
 * Name und Tag werden getrennt geprueft. Beides in einen Topf zu werfen war
 * ein Fehler: "social_facility" enthaelt "facility" und hat so jede
 * Sozialeinrichtung zum Hausmeisterdienst gemacht.
 */
export const KATEGORIEN = [
  {
    name: 'Genossenschaft', prio: 3,
    muster: /\b(bau|wohn\w*|siedlungs|miet\w*)[-\s]?genossenschaft\b|genossenschaft[-\s]?\w*(bau|wohn)|bauverein/i,
    // "eG" allein verraet nur die Rechtsform. Reicht als Treffer, wird aber
    // von der Branchensperre gestochen - sonst landen Volksbanken hier.
    schwach: /\beG\b|e\. ?G\./,
    // Kein office=cooperative: das Tag meint jede eingetragene Genossenschaft,
    // vom Bioladen bis zur Energiegenossenschaft.
    tagMuster: /housing_association/i,
  },
  {
    name: 'Wohnungsunternehmen', prio: 3,
    muster: /wohnungsbau|wohnungsgesellschaft|wohnungsunternehmen|wohnbau|wohnstätt|wohnstaett|siedlungsgesellschaft|zweckbau|wohnungswirtschaft|wohn-\s?und\s?(zweck|gewerbe|eigenheim|siedlungs)bau|vonovia|deutsche wohnen|nibelungen-?\s?wohnbau/i,
    tagMuster: null,
  },
  {
    name: 'Studenten-/Wohnheim', prio: 3,
    muster: /studentenwerk|studierendenwerk|wohnheim|\binternat(s\w*)?\b|gemeinschaftsunterkunft|jugendwohn/i,
    tagMuster: /dormitory/i,
  },
  {
    name: 'Hausverwaltung', prio: 3,
    muster: /hausverwaltung|immobilienverwaltung|wohnungsverwaltung|mietverwaltung|objektverwaltung|weg-verwaltung|sondereigentum|hausverw|property management|liegenschaftsverw|\bhvg?\b/i,
    tagMuster: /property_management/i,
  },
  {
    name: 'Wohnobjekt-Betreiber', prio: 3,
    // Betreiber ganzer Wohnblocks - steht als operator am Gebaeude, ohne dass
    // der Name die Branche verraet. Trotzdem genau die richtige Adresse.
    muster: null,
    tagMuster: /\b(apartments|residential)\b/i,
  },
  {
    name: 'Pflege/Senioren', prio: 2,
    muster: /senioren|altenheim|altenpflege|pflegeheim|pflegezentrum|wohnstift|betreutes wohnen|hospiz/i,
    tagMuster: /nursing_home|retirement_home|assisted_living|group_home|residential_home/i,
  },
  {
    name: 'Kirche/Sozialträger', prio: 2,
    muster: /diakonie|caritas|arbeiterwohlfahrt|\bawo\b|kirchengemeinde|propstei|landeskirche|sozialwerk|rotes kreuz|johanniter|malteser/i,
    tagMuster: /shelter/i,
  },
  {
    name: 'Facility/Hausmeister', prio: 2,
    muster: /facility|gebäudemanagement|gebaeudemanagement|hausmeister|gebäudeservice|hausservice/i,
    tagMuster: /facility_management|caretaker/i,
  },
  {
    name: 'Verwaltung/Grundbesitz', prio: 2,
    muster: /verwaltungsgesellschaft|grundbesitz|grundstücksverw|grundstuecksverw|liegenschaft/i,
    tagMuster: null,
  },
  {
    name: 'Makler/Immobilien', prio: 1,
    muster: /immobilien|makler/i,
    tagMuster: /estate_agent/i,
  },
];

/**
 * Wer so heisst, verwaltet keinen Wohnraum - egal welches Tag daran haengt.
 * Noetig, weil "eG" jede eingetragene Genossenschaft meint: Volksbanken,
 * Energiegenossenschaften und Bioladen-Kollektive genauso wie Baugenossenschaften.
 * Greift erst nach den eindeutigen Zielgruppen-Mustern, damit eine
 * "Wohnungsbaugenossenschaft der Sparkasse" nicht mit rausfliegt.
 */
export const BRANCHENFREMD =
  /\b(bank|volksbank|sparkasse|sparda|psd|raiffeisen|apotheke|praxis|zahnarzt|arzt|klinik|energiegenossenschaft|verbrauchergenossenschaft|einkaufsgenossenschaft|winzergenossenschaft|molkerei|spedition|logistik|fracht|taxi|restaurant|gaststätte|baeckerei|bäckerei|friseur|autohaus|werkstatt|versicherung|steuerberat|rechtsanwalt|notar)\b/i;

/**
 * Startpunkte, die keine Karte kennt: die offizielle Liste der Stadt
 * Braunschweig (braunschweig.de -> Wohnen -> Wohnungsunternehmen), Stand
 * August 2026. Telefonnummern stehen hier nur, wo die Stadt sie fuehrt -
 * E-Mails holt der Impressum-Schritt selbst, damit nichts veraltet drin steht.
 */
export const SEEDS = [
  { name: 'Nibelungen-Wohnbau-GmbH / Wohnstätten-Gesellschaft mbH', strasse: 'Freyastraße 10', plz: '38106', telefon: '0531 300030', website: 'https://www.nibelungen-wohnbau.de/' },
  { name: 'Bauen + Wohnen eG', strasse: 'Luisenstraße 27', plz: '38118', telefon: '0531 888980', website: 'https://www.bauwo-bs.de' },
  { name: 'Baugenossenschaft "Wiederaufbau" eG', strasse: 'Güldenstraße 25', plz: '38100', telefon: '0531 59030', website: 'https://www.wiederaufbau.de' },
  { name: 'Baugenossenschaft am Werder eG', strasse: 'Werder 7', plz: '38100', telefon: '0531 261570', website: 'https://www.werder-eg.de' },
  { name: 'Braunschweiger Baugenossenschaft eG', strasse: 'Celler Straße 66-69', plz: '38114', telefon: '0531 24130', website: 'https://www.baugenossenschaft.de' },
  { name: 'Handwerker-Wohnungsbau-Genossenschaft eG', strasse: 'Wabestraße 11', plz: '38106', telefon: '0531 338063', website: 'https://www.hawo-bs.de' },
  { name: 'Herrmann Eppers Wohnungsunternehmen', strasse: 'Wendentorwall 4/5', plz: '38100', telefon: '0531 45601', website: 'https://www.eppers.biz' },
  { name: 'HVg Michael Munte', strasse: 'Annette-Kolb-Str. 10', plz: '38124', telefon: '0531 379770', website: 'https://www.hvg-munte.de' },
  { name: 'Munte Immobilien GmbH', strasse: 'Casparistraße 1', plz: '38100', telefon: '0531 120640', website: 'https://www.munte-immobilien.de' },
  { name: 'Vereinigte Wohnungsgenossenschaft eG', strasse: 'Bültenweg 31 A', plz: '38106', telefon: '0531 1298980', website: 'https://www.vwg-braunschweig.de' },
  { name: 'Vonovia SE (Standort Braunschweig)', strasse: 'Kleine Campestraße 1', plz: '38102', telefon: '0234 414700000', email: 'service@vonovia.info', website: 'https://www.vonovia.de' },
  { name: 'Wohn- und Eigenheimbau eG', strasse: 'Kriemhildstraße 30', plz: '38106', telefon: '0531 322732', website: 'https://www.schoener-wohnen-in-braunschweig.de/' },
  { name: 'Wohn- und Zweckbau Niedersachsen GmbH', strasse: 'Sonnenstraße 10A', plz: '38100', telefon: '0531 233333', email: 'info@wohn-und-zweckbau.de', website: 'https://www.wohn-und-zweckbau.de' },
  { name: 'Wohnungsbau und Verwaltungsgesellschaft mbH', strasse: 'Am Hirtenberg 4', plz: '38104', telefon: '0531 36601' },
  // Grosse Wohnheimtraeger - stehen in keiner Wohnungsunternehmen-Liste,
  // haben aber die vollsten Fahrradkeller der Stadt.
  { name: 'Studentenwerk OstNiedersachsen (Wohnheime Braunschweig)', strasse: 'Katharinenstraße 1', plz: '38106', website: 'https://www.stw-on.de/' },
];

/** Unterseiten, auf denen deutsche Firmenseiten ihre Kontaktdaten fuehren. */
export const IMPRESSUM_PFADE = [
  '/impressum', '/impressum.html', '/impressum.php', '/impressum/',
  '/kontakt', '/kontakt.html', '/kontakt/', '/kontakt.php',
  '/ueber-uns/impressum', '/service/impressum', '/de/impressum',
];

/**
 * Adressen, die zwar auf Firmenseiten stehen, aber niemandem gehoeren, den
 * wir anschreiben wollen (Agentur, Datenschutzbeauftragter, Formularrelais).
 */
export const EMAIL_SPERRE = [
  /^(no-?reply|donotreply|postmaster|abuse|hostmaster|webmaster|admin|root)@/i,
  /@(example|test|localhost|sentry|wordpress|w3\.org|schema\.org)\b/i,
  /\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i,
  /^[0-9a-f]{16,}@/i,        // Wegwerf-Hashes aus Spamschutz-Skripten
  /@sentry\./i,
  // Massenhoster - ihre Adresse steht im Impressum vieler kleiner Firmenseiten.
  /@(alfahosting|strato|ionos|1und1|1and1|hosteurope|netcup|all-inkl|df\.eu|jimdo|wix|webgo|mittwald|hetzner|domainfactory|united-domains|checkdomain|goneo|lima-city|web\.de|gmx\.(net|de)?)\b/i,
];

/** Braunschweiger Vorwahlen und Umland - Nummern ausserhalb sind meist Zentralen. */
export const BS_VORWAHLEN = ['531', '5307', '5300', '5308', '5309', '5332', '5341'];
