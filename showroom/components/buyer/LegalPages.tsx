import React from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  Info,
  RotateCcw,
  ScrollText,
  Shield,
  Truck,
} from 'lucide-react';

import type { LegalPage, SellerProfile } from '../../types';
import { profileGaps } from '../../config/seller';

// ============================================================================
// Rechtliche Seiten des Showrooms
// ----------------------------------------------------------------------------
// Alle Angaben kommen ausschließlich aus dem Verkäufer-Profil. Fehlt etwas,
// wird das offen als "— fehlt —" ausgewiesen, statt einen Platzhalter zu
// erfinden: ein Impressum mit Fantasieangaben ist schlimmer als ein
// unvollständiges.
// ============================================================================

export interface LegalPagesProps {
  page: LegalPage;
  profile: SellerProfile;
  onBack: () => void;
  onOpenLegal: (page: LegalPage) => void;
}

const TABS: { key: LegalPage; label: string; Icon: typeof FileText }[] = [
  { key: 'impressum', label: 'Impressum', Icon: FileText },
  { key: 'datenschutz', label: 'Datenschutz', Icon: Shield },
  { key: 'widerruf', label: 'Widerruf', Icon: RotateCcw },
  { key: 'agb', label: 'AGB', Icon: ScrollText },
  { key: 'versand', label: 'Versand & Zahlung', Icon: Truck },
];

const TITLES: Record<LegalPage, string> = {
  impressum: 'Impressum',
  datenschutz: 'Datenschutzerklärung',
  widerruf: 'Widerrufsbelehrung',
  agb: 'Allgemeine Geschäftsbedingungen',
  versand: 'Versand, Abholung und Zahlung',
};

/** Zeigt einen Profilwert an oder markiert ihn sichtbar als fehlend. */
function Value({ value }: { value?: string }) {
  const v = (value ?? '').trim();
  if (v) return <>{v}</>;
  return <span style={{ color: 'var(--sr-bad)' }}>— fehlt —</span>;
}

function val(value?: string, fallback = '— fehlt —'): string {
  const v = (value ?? '').trim();
  return v || fallback;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="sr-display text-lg font-semibold mb-2">{title}</h3>
      <div
        className="space-y-2 text-[15px] leading-relaxed"
        style={{ color: 'var(--sr-muted)' }}
      >
        {children}
      </div>
    </section>
  );
}

function Note({
  tone = 'accent',
  children,
}: {
  tone?: 'accent' | 'warn';
  children: React.ReactNode;
}) {
  const color = tone === 'warn' ? 'var(--sr-warn)' : 'var(--sr-accent)';
  return (
    <div
      className="sr-panel-flat p-4 flex items-start gap-3 text-[15px] leading-relaxed"
      style={{ borderColor: color, color: 'var(--sr-text)' }}
    >
      <Info className="w-5 h-5 shrink-0 mt-0.5" style={{ color }} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function LegalPages({ page, profile, onBack, onOpenLegal }: LegalPagesProps) {
  return (
    <div className="p-4 sm:p-6 sr-fade-in">
      <button type="button" onClick={onBack} className="sr-btn sr-btn-ghost">
        <ArrowLeft className="w-4 h-4" />
        Zurück
      </button>

      <div className="mt-4 flex gap-2 overflow-x-auto sr-scroll pb-1">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onOpenLegal(key)}
            className={`sr-btn shrink-0 ${key === page ? 'sr-btn-primary' : 'sr-btn-quiet'}`}
            style={{ padding: '7px 14px', fontSize: 13 }}
            aria-current={key === page ? 'page' : undefined}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <article className="sr-panel p-5 sm:p-7 mt-4 max-w-3xl">
        <h2 className="sr-display text-2xl font-semibold">{TITLES[page]}</h2>
        <hr className="sr-rule my-4" />

        {page === 'impressum' && <Impressum profile={profile} />}
        {page === 'datenschutz' && <Datenschutz profile={profile} />}
        {page === 'widerruf' && <Widerruf profile={profile} />}
        {page === 'agb' && <Agb profile={profile} />}
        {page === 'versand' && <Versand profile={profile} />}
      </article>
    </div>
  );
}

// --- Impressum -------------------------------------------------------------

function Impressum({ profile }: { profile: SellerProfile }) {
  const gaps = profileGaps(profile);
  const responsible = (profile.responsiblePerson || profile.legalName || '').trim();

  return (
    <div>
      {gaps.length > 0 && (
        <div
          className="sr-panel-flat p-4 mb-6 flex items-start gap-3 text-[15px] leading-relaxed"
          style={{ borderColor: 'var(--sr-bad)', color: 'var(--sr-text)' }}
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--sr-bad)' }} />
          <div className="min-w-0">
            <strong>Diesem Impressum fehlen noch Pflichtangaben:</strong> {gaps.join(', ')} — bitte
            im Verkäufer-Profil ergänzen, bevor die Seite online geht.
          </div>
        </div>
      )}

      <Section title="Angaben gemäß § 5 DDG">
        <p className="whitespace-pre-line">
          <Value value={profile.legalName} />
          {'\n'}
          <Value value={profile.street} />
          {'\n'}
          {val(profile.zip, '—')} {val(profile.city, '—')}
          {'\n'}
          {val(profile.country, 'Deutschland')}
        </p>
      </Section>

      <Section title="Kontakt">
        <p>
          E-Mail: <Value value={profile.email} />
        </p>
        {profile.phone?.trim() && <p>Telefon: {profile.phone.trim()}</p>}
        {profile.website?.trim() && <p>Website: {profile.website.trim()}</p>}
      </Section>

      <Section title="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        <p>
          <Value value={responsible} />
          {responsible && profile.street.trim() ? (
            <>
              , {val(profile.street, '')} {val(profile.zip, '')} {val(profile.city, '')}
            </>
          ) : null}
        </p>
      </Section>

      <Section title="Umsatzsteuer">
        {profile.vatId?.trim() ? (
          <p>
            Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz:{' '}
            {profile.vatId.trim()}
          </p>
        ) : profile.kleinunternehmer ? (
          <p>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet und ausgewiesen.</p>
        ) : (
          <p>
            Eine Umsatzsteuer-Identifikationsnummer ist im Verkäufer-Profil nicht hinterlegt.
          </p>
        )}
      </Section>

      <Section title="Streitbeilegung">
        <p>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung bereit:{' '}
          <a
            href="https://ec.europa.eu/consumers/odr/"
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: 'var(--sr-accent)' }}
          >
            https://ec.europa.eu/consumers/odr/
          </a>
          . Meine E-Mail-Adresse findest du oben unter „Kontakt“.
        </p>
        <p>
          Ich bin nicht bereit und nicht verpflichtet, an einem Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </Section>
    </div>
  );
}

// --- Datenschutz -----------------------------------------------------------

function Datenschutz({ profile }: { profile: SellerProfile }) {
  return (
    <div>
      <Section title="Verantwortliche Stelle">
        <p className="whitespace-pre-line">
          <Value value={profile.legalName} />
          {'\n'}
          <Value value={profile.street} />
          {'\n'}
          {val(profile.zip, '—')} {val(profile.city, '—')}
          {'\n'}
          E-Mail: {val(profile.email)}
          {profile.phone?.trim() ? `\nTelefon: ${profile.phone.trim()}` : ''}
        </p>
      </Section>

      <Section title="Was das Kontaktformular erhebt">
        <p>
          Wenn du das Kontaktformular benutzt, werden dein Name, deine E-Mail-Adresse, auf Wunsch
          deine Telefonnummer, deine Nachricht und – falls du einen angibst – dein Preisvorschlag
          übermittelt. Mehr wird nicht abgefragt.
        </p>
        <p>
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, soweit es um die Anbahnung eines Kaufs
          geht, im Übrigen Art. 6 Abs. 1 lit. f DSGVO: das berechtigte Interesse, auf eine Anfrage
          überhaupt antworten zu können.
        </p>
      </Section>

      <Section title="Wie lange die Daten bleiben">
        <p>
          Deine Angaben werden ausschließlich zur Bearbeitung deiner Anfrage genutzt und danach
          gelöscht, sobald sie nicht mehr gebraucht werden. Kommt ein Kauf zustande, bleiben die
          Unterlagen so lange gespeichert, wie es die steuer- und handelsrechtlichen
          Aufbewahrungspflichten verlangen. Weitergegeben werden deine Daten nicht.
        </p>
      </Section>

      <Section title="Server-Logfiles">
        <p>
          Beim Aufruf dieser Seite speichert der Hoster automatisch technische Daten wie IP-Adresse,
          Datum und Uhrzeit, aufgerufene Seite und Browsertyp. Das ist für den sicheren Betrieb
          nötig (Art. 6 Abs. 1 lit. f DSGVO) und wird nicht mit anderen Daten zusammengeführt.
        </p>
      </Section>

      <Section title="Keine Werbe-Cookies, kein Tracking">
        <p>
          Diese Seite setzt keine Werbe-Cookies, bindet keine Analysedienste ein und verfolgt dich
          nicht über andere Seiten hinweg. Merkliste und Einstellungen liegen lokal in deinem
          Browser und verlassen dein Gerät nicht.
        </p>
      </Section>

      <Section title="Deine Rechte">
        <p>
          Du hast das Recht auf Auskunft über die zu dir gespeicherten Daten, auf Berichtigung, auf
          Löschung, auf Einschränkung der Verarbeitung, auf Datenübertragbarkeit sowie das Recht,
          der Verarbeitung zu widersprechen. Eine kurze Nachricht an die oben genannte Adresse
          genügt. Außerdem kannst du dich bei der für dich zuständigen Datenschutz-Aufsichtsbehörde
          beschweren.
        </p>
      </Section>

      <div className="mt-6">
        <Note tone="warn">
          Dieser Text ist eine solide Grundlage, aber keine Rechtsberatung — prüfe ihn, sobald du
          Zahlungsdienste, Karten oder Statistik einbindest.
        </Note>
      </div>
    </div>
  );
}

// --- Widerruf --------------------------------------------------------------

function Widerruf({ profile }: { profile: SellerProfile }) {
  if (profile.isCommercial === false) {
    return (
      <div>
        <Section title="Privatverkauf – kein gesetzliches Widerrufsrecht">
          <p>
            Die Räder werden hier privat verkauft, nicht gewerblich. Ein gesetzliches Widerrufsrecht
            gibt es deshalb nicht: Es gilt nur für Verträge zwischen einem Unternehmer und einem
            Verbraucher.
          </p>
          <p>
            Dafür kannst du dir jedes Rad in Ruhe ansehen und Probe fahren, bevor du dich
            entscheidest. Alle bekannten Mängel stehen offen in der Anzeige – frag lieber einmal zu
            viel nach als einmal zu wenig.
          </p>
        </Section>
      </div>
    );
  }

  const anschrift = [
    val(profile.legalName),
    val(profile.street),
    `${val(profile.zip, '—')} ${val(profile.city, '—')}`,
    `E-Mail: ${val(profile.email)}`,
    profile.phone?.trim() ? `Telefon: ${profile.phone.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const muster = `An:
${anschrift}

Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*):

Bestellt am (*) / erhalten am (*):
Name des/der Verbraucher(s):
Anschrift des/der Verbraucher(s):
Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier):
Datum:

(*) Unzutreffendes streichen.`;

  return (
    <div>
      <Note>
        <strong>Wichtig zuerst:</strong> Holst du das Rad ab und schließt du den Vertrag vor Ort in
        den Geschäftsräumen, besteht kein Widerrufsrecht – das gilt nur für Verträge im Fernabsatz
        oder außerhalb von Geschäftsräumen. Wird das Rad geliefert oder versendet und der Vertrag
        vorher aus der Ferne geschlossen, hast du das folgende Widerrufsrecht.
      </Note>

      <Section title="Widerrufsrecht">
        <p>
          Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu
          widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem du oder ein von
          dir benannter Dritter, der nicht der Beförderer ist, die Ware in Besitz genommen hast bzw.
          hat.
        </p>
        <p className="whitespace-pre-line">
          {`Um dein Widerrufsrecht auszuüben, musst du mich\n\n${anschrift}\n\nmittels einer eindeutigen Erklärung (zum Beispiel per Brief oder E-Mail) über deinen Entschluss informieren, diesen Vertrag zu widerrufen. Du kannst dafür das nachstehende Muster-Formular verwenden, das ist aber nicht vorgeschrieben.`}
        </p>
        <p>
          Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die Ausübung des
          Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.
        </p>
      </Section>

      <Section title="Folgen des Widerrufs">
        <p>
          Wenn du diesen Vertrag widerrufst, erstatte ich dir alle Zahlungen, die ich von dir
          erhalten habe, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die
          sich daraus ergeben, dass du eine andere Art der Lieferung als die von mir angebotene,
          günstigste Standardlieferung gewählt hast), unverzüglich und spätestens binnen vierzehn
          Tagen ab dem Tag, an dem die Mitteilung über deinen Widerruf bei mir eingegangen ist.
        </p>
        <p>
          Für die Rückzahlung verwende ich dasselbe Zahlungsmittel, das du bei der ursprünglichen
          Zahlung eingesetzt hast, es sei denn, wir vereinbaren ausdrücklich etwas anderes; wegen
          dieser Rückzahlung werden dir keine Entgelte berechnet. Ich kann die Rückzahlung
          verweigern, bis ich die Ware zurückerhalten habe oder du den Nachweis erbracht hast, dass
          du sie zurückgesandt hast – je nachdem, was früher ist.
        </p>
        <p>
          Du hast die Ware unverzüglich und in jedem Fall spätestens binnen vierzehn Tagen ab dem
          Tag, an dem du mich über den Widerruf unterrichtest, zurückzusenden oder zu übergeben. Die
          unmittelbaren Kosten der Rücksendung trägst du. Für einen Wertverlust der Ware musst du
          nur aufkommen, wenn dieser Wertverlust auf einen Umgang mit der Ware zurückzuführen ist,
          der zur Prüfung der Beschaffenheit, Eigenschaften und Funktionsweise nicht notwendig war.
        </p>
      </Section>

      <Section title="Muster-Widerrufsformular">
        <p>
          Wenn du den Vertrag widerrufen willst, kannst du dieses Formular ausfüllen und
          zurücksenden.
        </p>
        <div className="sr-inset p-4 mt-2 overflow-x-auto">
          <pre
            className="whitespace-pre-wrap text-sm leading-relaxed"
            style={{ color: 'var(--sr-text)' }}
          >
            {muster}
          </pre>
        </div>
      </Section>
    </div>
  );
}

// --- AGB -------------------------------------------------------------------

function Agb({ profile }: { profile: SellerProfile }) {
  const gewerblich = profile.isCommercial !== false;

  return (
    <div>
      <Section title="§ 1 Geltungsbereich">
        <p>
          Diese Bedingungen gelten für den Verkauf gebrauchter Fahrräder und gebrauchten Zubehörs
          durch <Value value={profile.legalName} /> an Käuferinnen und Käufer. Abweichende
          Vereinbarungen gelten nur, wenn sie ausdrücklich in Textform bestätigt werden.
        </p>
      </Section>

      <Section title="§ 2 Vertragsschluss">
        <p>
          Die Anzeigen im Showroom sind noch kein bindendes Angebot, sondern eine Einladung, mir
          eines zu machen. Der Kaufvertrag kommt zustande, wenn ich deine Anfrage ausdrücklich
          bestätige oder wir das Rad bei der Übergabe gemeinsam abschließen. Jedes Rad gibt es nur
          einmal – bis zur Bestätigung kann es also noch anderweitig verkauft sein.
        </p>
      </Section>

      <Section title="§ 3 Preise und Zahlung">
        <p>
          Alle Preise sind Endpreise{' '}
          {profile.kleinunternehmer
            ? 'ohne Ausweis der Umsatzsteuer (§ 19 UStG).'
            : 'einschließlich der gesetzlichen Umsatzsteuer.'}{' '}
          Bezahlt wird bar bei der Abholung oder per Überweisung; bei Versand oder Lieferung vorab
          per Überweisung, sofern nichts anderes vereinbart ist.
        </p>
      </Section>

      <Section title="§ 4 Übergabe und Eigentumsvorbehalt">
        <p>
          Regelfall ist die Abholung nach Absprache. Lieferung und Versand sind Ausnahmen und werden
          im Einzelfall vereinbart. Bis zur vollständigen Bezahlung bleibt die Ware mein Eigentum.
        </p>
      </Section>

      <Section title="§ 5 Gewährleistung">
        {gewerblich ? (
          <>
            <p>
              Es gelten die gesetzlichen Bestimmungen über die Mängelhaftung. Beim Verkauf
              gebrauchter Sachen wird die Verjährungsfrist für Mängelansprüche auf ein Jahr ab
              Übergabe der Ware verkürzt. Auf diese Verkürzung wird hier ausdrücklich und gesondert
              hingewiesen; sie wird mit dem Kaufvertrag ausdrücklich vereinbart.
            </p>
            <p>
              Die Verkürzung gilt nicht für Schadensersatzansprüche wegen Verletzung von Leben,
              Körper oder Gesundheit, nicht bei Vorsatz oder grober Fahrlässigkeit und nicht, soweit
              ich einen Mangel arglistig verschwiegen habe.
            </p>
          </>
        ) : (
          <p>
            Der Verkauf erfolgt privat. Eine Gewährleistung für Mängel ist ausgeschlossen, soweit
            das gesetzlich zulässig ist. Der Ausschluss gilt nicht bei arglistigem Verschweigen
            eines Mangels und nicht für Schäden aus der Verletzung von Leben, Körper oder
            Gesundheit.
          </p>
        )}
      </Section>

      <Section title="§ 6 Bekannte Mängel">
        <p>
          Gebrauchte Räder haben Gebrauchsspuren. Alle mir bekannten Mängel stehen offen in der
          jeweiligen Anzeige und werden vor dem Kauf besprochen; sie gelten damit als vereinbarte
          Beschaffenheit der Ware und sind kein Mangel im Sinne des Gesetzes. Der beschriebene und
          gezeigte Zustand ist der Zustand, den du bekommst.
        </p>
      </Section>

      <Section title="§ 7 Anwendbares Recht und Gerichtsstand">
        <p>
          Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts.
          Gegenüber Verbraucherinnen und Verbrauchern bleibt es bei den gesetzlichen
          Gerichtsstandsregelungen; ein abweichender Gerichtsstand wird nicht vereinbart.
        </p>
      </Section>
    </div>
  );
}

// --- Versand & Zahlung -----------------------------------------------------

function Versand({ profile }: { profile: SellerProfile }) {
  const ort = (profile.city ?? '').trim();

  return (
    <div>
      <Section title="Abholung ist der Regelfall">
        <p>
          {profile.pickupNote?.trim()
            ? profile.pickupNote.trim()
            : `Die Räder werden ${ort ? `in ${ort} ` : ''}abgeholt. Termin nach Absprache – schreib mir einfach, wann es dir passt.`}
        </p>
        {profile.openingHours?.trim() && <p>Zeiten: {profile.openingHours.trim()}</p>}
        <p>
          Vor Ort kannst du dir das Rad in Ruhe ansehen, alles durchprobieren und Fragen stellen.
          Erst danach musst du dich entscheiden.
        </p>
      </Section>

      <Section title="Lieferung im Umkreis">
        <p>
          Im näheren Umkreis {ort ? `um ${ort} ` : ''}liefere ich nach Absprache. Ob und zu welchen
          Kosten das geht, klären wir vorher – je nach Entfernung und Rad.
        </p>
      </Section>

      <Section title="Versand nur ausnahmsweise">
        <p>
          Ein Fahrrad ist sperrig und beim Transport empfindlich. Versand ist deshalb die Ausnahme
          und nur nach ausdrücklicher Vereinbarung möglich. Verpackung, Kosten und Versandweg werden
          vorher besprochen; der Versand erfolgt zu den vereinbarten Bedingungen auf dem vereinbarten
          Weg.
        </p>
      </Section>

      <Section title="Zahlung">
        <p>
          Bei Abholung bar oder per Überweisung. Bei Lieferung oder Versand vorab per Überweisung,
          sofern wir nichts anderes vereinbart haben. Eine Quittung bzw. einen Kaufvertrag bekommst
          du in jedem Fall.
        </p>
      </Section>

      <Section title="Probefahrt">
        <p>
          Probe fahren ist selbstverständlich möglich. Dafür hinterlegst du bitte einen Ausweis oder
          ein angemessenes Pfand – nicht aus Misstrauen, sondern weil das bei Gebrauchträdern schlicht
          üblich ist.
        </p>
      </Section>
    </div>
  );
}

export default LegalPages;
