import React, { useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Info,
  Link2,
  Palette,
  Phone,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
} from 'lucide-react';

import type {
  InquiryTransportKind,
  Perspective,
  SellerProfile,
  ShowroomListing,
  ShowroomSettings,
} from '../../types';
import { profileGaps } from '../../config/seller';
import { ENDPOINT_CONTRACT } from '../../lib/inquiries';
import { copyToClipboard } from '../../lib/share';

// ============================================================================
// Profil & Impressum
// ----------------------------------------------------------------------------
// Alles, was der Showroom über den Verkäufer weiß, wird hier gepflegt. Es gibt
// bewusst keinen Speichern-Knopf: jede Eingabe geht sofort nach oben, die
// Wurzelkomponente schreibt sie in den Browser-Speicher. Ein halb ausgefülltes
// Impressum, das beim Verlassen der Seite verloren geht, wäre schlimmer als
// ein Feld, das sich beim Tippen schon ändert.
//
// Echte Personendaten stehen deshalb nirgends im Quellcode – dieses Repo wird
// öffentlich gebaut. Sie leben im Browser und wandern nur über den bewussten
// Website-Export mit.
// ============================================================================

const ACCENT_PRESETS: { hex: string; label: string }[] = [
  { hex: '#c8934a', label: 'Messing' },
  { hex: '#b06a3b', label: 'Kupfer' },
  { hex: '#7f9c7b', label: 'Salbei' },
  { hex: '#6a86a8', label: 'Stahlblau' },
  { hex: '#9c5a5a', label: 'Bordeaux' },
];

const TRANSPORT_OPTIONS: { key: InquiryTransportKind; label: string; hint: string }[] = [
  {
    key: 'lokal',
    label: 'Nur im Browser',
    hint:
      'Anfragen landen direkt in deinem Posteingang auf diesem Gerät. Gut zum Ausprobieren, ' +
      'solange es noch keine echte Website gibt.',
  },
  {
    key: 'mailto',
    label: 'Per E-Mail-Programm',
    hint:
      'Das Formular öffnet das Mailprogramm des Interessenten mit fertigem Text. Braucht ' +
      'keinen Server – der richtige Weg für eine frisch aufgesetzte Website.',
  },
  {
    key: 'http',
    label: 'Eigener Endpunkt',
    hint:
      'Die Website schickt die Anfrage an eine eigene Adresse (eigener Server oder ein ' +
      'Formulardienst). Nur so landen Anfragen aus dem Netz automatisch im Posteingang.',
  },
];

const PERSPECTIVE_OPTIONS: { key: Perspective; label: string }[] = [
  { key: 'verkaeufer', label: 'Verkäufer-Ansicht (Anzeigen pflegen)' },
  { key: 'kaeufer', label: 'Käufer-Ansicht (so sieht es im Netz aus)' },
];

const MAX_LOGO_BYTES = 400 * 1024;

/** `input type="color"` verlangt einen sauberen Hex-Wert, sonst springt es auf Schwarz. */
function safeHex(value?: string): string {
  const v = (value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#c8934a';
}

function accentVar(color: string): React.CSSProperties {
  return { ['--sr-accent' as string]: color } as React.CSSProperties;
}

// --- Bausteine -------------------------------------------------------------

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function Section({ title, icon, children }: SectionProps) {
  return (
    <section className="sr-panel p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-4">
        <span style={{ color: 'var(--sr-accent)' }}>{icon}</span>
        <h3 className="sr-eyebrow">{title}</h3>
      </div>
      {children}
    </section>
  );
}

interface FieldProps {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  type?: string;
  inputMode?: 'text' | 'email' | 'tel' | 'url' | 'numeric';
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  required,
  type = 'text',
  inputMode,
}: FieldProps) {
  const id = useId();
  const missing = !!required && !String(value ?? '').trim();
  return (
    <div>
      <label className="sr-label" htmlFor={id}>
        {label}
        {required && <span style={{ color: 'var(--sr-bad)' }}> *</span>}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        className="sr-input"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={missing ? { borderColor: 'var(--sr-bad)' } : undefined}
      />
      {hint && (
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--sr-faint)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface AreaProps {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  rows?: number;
}

function Area({ label, value, onChange, placeholder, hint, rows }: AreaProps) {
  const id = useId();
  return (
    <div>
      <label className="sr-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="sr-textarea"
        rows={rows}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--sr-faint)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <label
      className="sr-panel-flat p-3 flex items-start gap-3 cursor-pointer"
      style={checked ? { borderColor: 'var(--sr-accent-line)' } : undefined}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 shrink-0"
        style={{ accentColor: 'var(--sr-accent)' }}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs mt-1 leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
          {description}
        </span>
      </span>
    </label>
  );
}

// --- Hauptkomponente -------------------------------------------------------

export interface SellerProfileFormProps {
  profile: SellerProfile;
  settings: ShowroomSettings;
  listings: ShowroomListing[];
  onProfileChange: (patch: Partial<SellerProfile>) => void;
  onSettingsChange: (patch: Partial<ShowroomSettings>) => void;
  onExportWebsite: () => void;
  onImportBundle: (json: string) => boolean;
  onBack: () => void;
}

export function SellerProfileForm({
  profile,
  settings,
  listings,
  onProfileChange,
  onSettingsChange,
  onExportWebsite,
  onImportBundle,
  onBack,
}: SellerProfileFormProps) {
  const [logoError, setLogoError] = useState('');
  const [contractCopied, setContractCopied] = useState(false);
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);

  const gaps = profileGaps(profile);
  const accent = safeHex(profile.accent);

  // Was der Website-Export mitnimmt – Entwürfe bleiben ausdrücklich hier.
  const exportCount = listings.filter((l) => l.status !== 'entwurf').length;
  const draftCount = listings.length - exportCount;

  function handleLogoFile(file?: File | null) {
    if (!file) return;
    setLogoError('');
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(
        `Das Bild ist ${Math.round(file.size / 1024)} KB groß. Mehr als 400 KB passen nicht ` +
          'in den Browser-Speicher, ohne dass es woanders eng wird. Bitte verkleinere es zuerst.',
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result) onProfileChange({ logoDataUrl: result });
      else setLogoError('Die Datei konnte nicht gelesen werden.');
    };
    reader.onerror = () => setLogoError('Die Datei konnte nicht gelesen werden.');
    reader.readAsDataURL(file);
  }

  function handleBundleFile(file?: File | null) {
    if (!file) return;
    setImportNote(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const ok = onImportBundle(text);
      setImportNote(
        ok
          ? { ok: true, text: 'Daten eingelesen. Profil, Einstellungen und Anzeigen sind übernommen.' }
          : { ok: false, text: 'Die Datei passt nicht zum Showroom-Format.' },
      );
    };
    reader.onerror = () => setImportNote({ ok: false, text: 'Die Datei konnte nicht gelesen werden.' });
    reader.readAsText(file);
  }

  async function handleCopyContract() {
    const ok = await copyToClipboard(ENDPOINT_CONTRACT);
    setContractCopied(ok);
    if (ok) window.setTimeout(() => setContractCopied(false), 2200);
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Kopfzeile */}
      <div className="flex items-center gap-3 mb-5">
        <button type="button" onClick={onBack} className="sr-btn sr-btn-quiet">
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </button>
        <h2 className="sr-display text-xl sm:text-2xl font-semibold">Profil &amp; Impressum</h2>
      </div>

      <div className="grid gap-4">
        {/* 1 — Pflichtangaben ------------------------------------------------ */}
        {gaps.length > 0 ? (
          <div
            className="sr-panel p-4 sm:p-5"
            style={{ borderColor: 'var(--sr-bad)' }}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--sr-bad)' }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Dem Impressum fehlen noch Angaben</p>
                <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
                  Sobald du Räder öffentlich anbietest, brauchst du ein vollständiges Impressum.
                  Fehlt es, kann das abgemahnt werden. Diese Felder sind noch leer:
                </p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {gaps.map((gap) => (
                    <li key={gap} className="sr-chip sr-chip-bad">
                      {gap}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="sr-panel-flat p-4 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--sr-good)' }} />
            <p className="text-sm leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
              Das Impressum ist vollständig. Die Angaben erscheinen im Showroom unter
              „Impressum“ und in den Kontaktbereichen.
            </p>
          </div>
        )}

        <div className="sr-inset p-4 flex items-start gap-3">
          <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--sr-faint)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
            Diese Angaben liegen absichtlich nur in deinem Browser. Der Quellcode dieses Projekts
            ist öffentlich einsehbar – deshalb steht dort kein Name, keine Anschrift und keine
            Nummer. Auf die echte Website kommen die Daten erst mit dem Website-Export ganz unten.
          </p>
        </div>

        {/* 2 — Showroom ------------------------------------------------------ */}
        <Section title="Showroom" icon={<Store className="w-4 h-4" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Name des Showrooms"
              value={profile.displayName}
              onChange={(v) => onProfileChange({ displayName: v })}
              placeholder="z. B. Fahrrad Butz"
              hint="Steht groß über der Seite."
            />
            <Field
              label="Untertitel"
              value={profile.tagline}
              onChange={(v) => onProfileChange({ tagline: v })}
              placeholder="Gebrauchte Fahrräder, ehrlich hergerichtet."
              hint="Ein Satz, der sagt, worum es geht."
            />
          </div>

          <div className="mt-4">
            <Area
              label="Über mich"
              value={profile.about}
              onChange={(v) => onProfileChange({ about: v })}
              placeholder="Wie du arbeitest, was ein Käufer bei dir erwarten kann …"
              hint="Erscheint auf der Startseite des Showrooms. Ruhig konkret werden – das schafft mehr Vertrauen als jede Werbefloskel."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 mt-4">
            <Field
              label="Öffnungszeiten"
              value={profile.openingHours}
              onChange={(v) => onProfileChange({ openingHours: v })}
              placeholder="Besichtigung nach Absprache"
            />
            <Field
              label="Hinweis zur Abholung"
              value={profile.pickupNote}
              onChange={(v) => onProfileChange({ pickupNote: v })}
              placeholder="Abholung in … Probefahrt ist möglich."
              hint="Wird auch in den vorgeschlagenen Antworten im Posteingang verwendet."
            />
          </div>
        </Section>

        {/* 3 — Kontakt ------------------------------------------------------- */}
        <Section title="Kontakt" icon={<Phone className="w-4 h-4" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="E-Mail"
              type="email"
              inputMode="email"
              required
              value={profile.email}
              onChange={(v) => onProfileChange({ email: v })}
              placeholder="post@beispiel.de"
              hint="Pflichtangabe im Impressum und Ziel der Anfragen."
            />
            <Field
              label="Telefon"
              type="tel"
              inputMode="tel"
              value={profile.phone}
              onChange={(v) => onProfileChange({ phone: v })}
              placeholder="0531 1234567"
            />
            <Field
              label="WhatsApp-Nummer"
              type="tel"
              inputMode="tel"
              value={profile.whatsapp}
              onChange={(v) => onProfileChange({ whatsapp: v })}
              placeholder="+49 151 1234567"
              hint="Ohne Eintrag greift die Telefonnummer von nebenan. Fehlt beides, bleiben die WhatsApp-Knöpfe im Showroom ausgeblendet."
            />
            <Field
              label="Website"
              type="url"
              inputMode="url"
              value={profile.website}
              onChange={(v) => onProfileChange({ website: v })}
              placeholder="https://…"
            />
            <Field
              label="Instagram"
              value={profile.instagram}
              onChange={(v) => onProfileChange({ instagram: v })}
              placeholder="@dein.name"
            />
          </div>
        </Section>

        {/* 4 — Impressum ----------------------------------------------------- */}
        <Section title="Impressum" icon={<FileText className="w-4 h-4" />}>
          <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--sr-muted)' }}>
            Mit <span style={{ color: 'var(--sr-bad)' }}>*</span> markierte Felder verlangt § 5 DDG.
            Sie stehen später wörtlich auf der Impressum-Seite.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Vor- und Nachname (bzw. Firma)"
              required
              value={profile.legalName}
              onChange={(v) => onProfileChange({ legalName: v })}
              placeholder="Max Mustermann"
            />
            <Field
              label="Straße und Hausnummer"
              required
              value={profile.street}
              onChange={(v) => onProfileChange({ street: v })}
              placeholder="Musterweg 1"
            />
            <Field
              label="Postleitzahl"
              required
              inputMode="numeric"
              value={profile.zip}
              onChange={(v) => onProfileChange({ zip: v })}
              placeholder="38100"
            />
            <Field
              label="Ort"
              required
              value={profile.city}
              onChange={(v) => onProfileChange({ city: v })}
              placeholder="Braunschweig"
            />
            <Field
              label="Land"
              value={profile.country}
              onChange={(v) => onProfileChange({ country: v })}
              placeholder="Deutschland"
            />
            <Field
              label="Verantwortlich für den Inhalt"
              value={profile.responsiblePerson}
              onChange={(v) => onProfileChange({ responsiblePerson: v })}
              placeholder="Wie oben, falls jemand anders"
              hint="§ 18 Abs. 2 MStV. Leer lassen, wenn es dieselbe Person ist."
            />
            <Field
              label="Umsatzsteuer-ID"
              value={profile.vatId}
              onChange={(v) => onProfileChange({ vatId: v })}
              placeholder="DE123456789"
              hint="Nur ausfüllen, wenn du eine hast."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 mt-4">
            <Toggle
              label="Kleinunternehmer nach § 19 UStG"
              description="Preise werden ohne Umsatzsteuer-Ausweis dargestellt, dafür erscheint der übliche Hinweis auf § 19 UStG."
              checked={profile.kleinunternehmer}
              onChange={(v) => onProfileChange({ kleinunternehmer: v })}
            />
            <Toggle
              label="Ich verkaufe gewerblich"
              description="Der Showroom zeigt dann Widerrufsbelehrung und AGB und nennt die gesetzliche Gewährleistung. Ausgeschaltet gilt der Verkauf als privat – ohne Garantie, ohne Rücknahme."
              checked={profile.isCommercial}
              onChange={(v) => onProfileChange({ isCommercial: v })}
            />
          </div>
        </Section>

        {/* 5 — Aussehen ------------------------------------------------------ */}
        <Section title="Aussehen" icon={<Palette className="w-4 h-4" />}>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)] md:items-start">
            <div>
              <span className="sr-label">Akzentfarbe</span>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label="Akzentfarbe frei wählen"
                  value={accent}
                  onChange={(e) => onProfileChange({ accent: e.target.value })}
                  className="w-14 h-11 shrink-0 rounded-lg cursor-pointer bg-transparent"
                  style={{ border: '1px solid var(--sr-line)', padding: 2 }}
                />
                <input
                  type="text"
                  aria-label="Akzentfarbe als Hex-Wert"
                  className="sr-input"
                  value={profile.accent ?? ''}
                  onChange={(e) => onProfileChange({ accent: e.target.value })}
                  placeholder="#c8934a"
                />
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {ACCENT_PRESETS.map((preset) => {
                  const active = accent.toLowerCase() === preset.hex.toLowerCase();
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      onClick={() => onProfileChange({ accent: preset.hex })}
                      className="sr-chip"
                      style={
                        active
                          ? { borderColor: preset.hex, color: 'var(--sr-text)' }
                          : undefined
                      }
                      title={preset.hex}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0"
                        style={{ background: preset.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.4)' }}
                      />
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vorschau im gewählten Ton – der eigene Container erbt die neue Farbe. */}
            <div className="sr-inset p-4" style={accentVar(accent)}>
              <p className="sr-eyebrow mb-2">Vorschau</p>
              <p className="sr-display sr-brass text-lg font-semibold">
                {profile.displayName || 'Dein Showroom'}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="sr-btn sr-btn-primary pointer-events-none" aria-hidden="true">
                  Anfragen
                </span>
                <span className="sr-chip sr-chip-accent">Online</span>
              </div>
            </div>
          </div>

          <hr className="sr-rule my-5" />

          <div>
            <span className="sr-label">Logo</span>
            <div className="flex flex-wrap items-center gap-3">
              <div
                className="w-16 h-16 shrink-0 rounded-xl grid place-items-center overflow-hidden"
                style={{ background: 'var(--sr-ink-2)', border: '1px solid var(--sr-line)' }}
              >
                {profile.logoDataUrl ? (
                  <img
                    src={profile.logoDataUrl}
                    alt="Aktuelles Logo des Showrooms"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImageIcon className="w-5 h-5" style={{ color: 'var(--sr-faint)' }} />
                )}
              </div>

              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="sr-btn sr-btn-ghost"
              >
                <Upload className="w-4 h-4" />
                Logo hochladen
              </button>

              {profile.logoDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setLogoError('');
                    onProfileChange({ logoDataUrl: '' });
                  }}
                  className="sr-btn sr-btn-quiet"
                >
                  <Trash2 className="w-4 h-4" />
                  Logo entfernen
                </button>
              )}

              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  handleLogoFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>

            <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--sr-faint)' }}>
              PNG oder JPG, höchstens 400 KB. Das Bild wird im Browser gespeichert und wandert mit
              dem Website-Export mit.
            </p>
            {logoError && (
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--sr-bad)' }}>
                {logoError}
              </p>
            )}
          </div>
        </Section>

        {/* 6 — Verbindung zur Website ---------------------------------------- */}
        <Section title="Verbindung zur Website" icon={<Link2 className="w-4 h-4" />}>
          <span className="sr-label">Wohin gehen Anfragen?</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {TRANSPORT_OPTIONS.map((opt) => {
              const active = settings.transport === opt.key;
              return (
                <label
                  key={opt.key}
                  className="sr-panel-flat p-3 flex items-start gap-3 cursor-pointer"
                  style={
                    active
                      ? { borderColor: 'var(--sr-accent-line)', background: 'var(--sr-accent-soft)' }
                      : undefined
                  }
                >
                  <input
                    type="radio"
                    name="sr-transport"
                    checked={active}
                    onChange={() => onSettingsChange({ transport: opt.key })}
                    className="mt-1 w-4 h-4 shrink-0"
                    style={{ accentColor: 'var(--sr-accent)' }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{opt.label}</span>
                    <span
                      className="block text-xs mt-1 leading-relaxed"
                      style={{ color: 'var(--sr-muted)' }}
                    >
                      {opt.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {settings.transport === 'mailto' && !String(profile.email ?? '').trim() && (
            <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--sr-warn)' }}>
              Für diesen Weg fehlt noch deine E-Mail-Adresse oben – ohne sie kann das Formular
              kein Mailprogramm öffnen.
            </p>
          )}

          {settings.transport === 'http' && (
            <div className="mt-4 grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Adresse des Endpunkts"
                  type="url"
                  inputMode="url"
                  value={settings.endpointUrl}
                  onChange={(v) => onSettingsChange({ endpointUrl: v })}
                  placeholder="https://beispiel.de/api/anfragen"
                />
                <Field
                  label="Schlüssel (optional)"
                  value={settings.endpointKey}
                  onChange={(v) => onSettingsChange({ endpointKey: v })}
                  placeholder="frei wählbar"
                  hint="Wird als Kopfzeile X-Showroom-Key mitgeschickt, damit nicht jeder schreiben kann."
                />
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="sr-label" style={{ marginBottom: 0 }}>
                    Das braucht der Endpunkt
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyContract}
                    className="sr-btn sr-btn-quiet"
                    style={{ padding: '6px 12px', fontSize: 13 }}
                  >
                    {contractCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {contractCopied ? 'Kopiert' : 'Beschreibung kopieren'}
                  </button>
                </div>
                <div className="sr-inset sr-scroll overflow-x-auto">
                  <pre
                    className="p-3 text-xs leading-relaxed"
                    style={{ color: 'var(--sr-muted)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                  >
                    {ENDPOINT_CONTRACT}
                  </pre>
                </div>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--sr-faint)' }}>
                  Genau das gibst du der Person, die den Server einrichtet – oder du trägst die
                  Adresse eines Formulardienstes ein, der dasselbe kann.
                </p>
              </div>
            </div>
          )}

          <hr className="sr-rule my-5" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Adresse der Website"
              type="url"
              inputMode="url"
              value={settings.publicBaseUrl}
              onChange={(v) => onSettingsChange({ publicBaseUrl: v })}
              placeholder="https://fahrrad-beispiel.de"
              hint="Davon hängen die Teilen-Links ab. Ohne Eintrag zeigen sie auf die gerade geöffnete Seite und funktionieren nur bei dir."
            />
            <div>
              <span className="sr-label">Ansicht beim Öffnen</span>
              <select
                className="sr-select"
                aria-label="Ansicht beim Öffnen des Reiters"
                value={settings.defaultPerspective}
                onChange={(e) =>
                  onSettingsChange({ defaultPerspective: e.target.value as Perspective })
                }
              >
                {PERSPECTIVE_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--sr-faint)' }}>
                Womit der Reiter „Showroom“ startet. Umschalten kannst du jederzeit oben rechts.
              </p>
            </div>
          </div>
        </Section>

        {/* 7 — Daten ---------------------------------------------------------- */}
        <Section title="Daten" icon={<Database className="w-4 h-4" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sr-panel-flat p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
                <span className="text-sm font-semibold">Website-Daten exportieren</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
                Legt die Datei <code>showroom-data.json</code> an. Die legst du neben die
                eigenständige Website – sie liest daraus Profil, Impressum und Anzeigen.
                Entwürfe bleiben ausdrücklich hier und gehen nicht mit.
              </p>
              <p className="text-xs" style={{ color: 'var(--sr-faint)' }}>
                Dabei wären{' '}
                <span style={{ color: 'var(--sr-text)' }}>
                  {exportCount} {exportCount === 1 ? 'Anzeige' : 'Anzeigen'}
                </span>
                {draftCount > 0 && ` – ${draftCount} ${draftCount === 1 ? 'Entwurf bleibt' : 'Entwürfe bleiben'} draußen`}.
              </p>
              <button
                type="button"
                onClick={onExportWebsite}
                className="sr-btn sr-btn-primary self-start"
              >
                <Download className="w-4 h-4" />
                Exportieren
              </button>
            </div>

            <div className="sr-panel-flat p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4" style={{ color: 'var(--sr-accent)' }} />
                <span className="text-sm font-semibold">Daten einlesen</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--sr-muted)' }}>
                Liest eine zuvor exportierte <code>showroom-data.json</code> wieder ein – für den
                Umzug auf ein anderes Gerät oder zurück aus einer Sicherung. Anzeigen mit
                gleicher Kennung werden dabei überschrieben.
              </p>
              <button
                type="button"
                onClick={() => bundleInputRef.current?.click()}
                className="sr-btn sr-btn-ghost self-start"
              >
                <Upload className="w-4 h-4" />
                Datei auswählen
              </button>
              <input
                ref={bundleInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  handleBundleFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {importNote && (
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: importNote.ok ? 'var(--sr-good)' : 'var(--sr-bad)' }}
                >
                  {importNote.text}
                </p>
              )}
            </div>
          </div>
        </Section>

        <p className="flex items-center gap-2 text-xs pb-2" style={{ color: 'var(--sr-faint)' }}>
          <Eye className="w-3.5 h-3.5 shrink-0" />
          Änderungen werden sofort übernommen.
        </p>
      </div>
    </div>
  );
}

export default SellerProfileForm;
