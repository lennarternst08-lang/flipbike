@echo off
REM ============================================================================
REM  TAGESLAUF FlipBike - haelt fest, was sich seit dem letzten Lauf geaendert hat.
REM
REM  Zwei Quellen:
REM    1. WhatsApp  -> neue Nachrichten, daraus neue Flyer-Leads
REM    2. Betrieb   -> der ai_report aus Firestore, verglichen mit dem Vorlauf
REM                    - neue Raeder, Verkaeufe, Arbeitszeiten, Material, Flyer, Service
REM
REM  Ergebnis: oben in tagesnotiz.md ein neuer Abschnitt, dazu Kopien im
REM  Google-Drive-Ordner - dort liest der Connector von claude.ai sie live.
REM
REM  Gestartet von der Windows-Aufgabe "FlipBike-Tageslauf": taeglich um 20:00,
REM  ueber scripts/lauf-versteckt.vbs - sonst steht waehrend des Laufs ein
REM  Konsolenfenster auf dem Bildschirm.
REM  War der Rechner da aus, holt Windows den Lauf nach dem naechsten Start nach
REM  (StartWhenAvailable). Bewusst KEIN Anmelde-Trigger mehr: der hat frueher
REM  morgens den WhatsApp-Tageswaechter verbraucht, sodass alles nach 9 Uhr erst
REM  am naechsten Tag ausgewertet wurde.
REM
REM  Frueher hiess dieses Skript scan-whatsapp-leads.bat.
REM ============================================================================

setlocal
set PROJECT=C:\Users\Hacker.HPGAME.000\Downloads\remix_-fahrrad-butz-ki
set NODE_BIN=C:\Program Files\nodejs\node.exe
set LOG=%PROJECT%\tageslauf.log

REM --- Wo liegt claude wirklich? ---
REM Die Claude-Desktop-App ist eine paketierte Windows-App. Windows leitet ihre
REM Schreibzugriffe um: was in ihrer Shell als %APPDATA%\npm erscheint, liegt in
REM Wahrheit unter AppData\Local\Packages\Claude_*\LocalCache\Roaming\npm.
REM Der Taskplaner laeuft ausserhalb dieses Containers und sieht nur den echten
REM Pfad - deshalb hier zuerst der echte, dann der virtualisierte als Fallback.
set CLAUDE_PKG=C:\Users\Hacker.HPGAME.000\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe
set CLAUDE_ALT=C:\Users\Hacker.HPGAME.000\AppData\Roaming\npm\claude.cmd
if exist "%CLAUDE_PKG%" (set "CLAUDE_BIN=%CLAUDE_PKG%") else (set "CLAUDE_BIN=%CLAUDE_ALT%")

cd /d "%PROJECT%"

echo. >> "%LOG%"
echo ===== Tageslauf %DATE% %TIME% ===== >> "%LOG%"
echo claude: %CLAUDE_BIN% >> "%LOG%"

REM --- Schritt 0: Sicherstellen, dass die WhatsApp-Bridge laeuft. ---
REM     Ist sie tot, waechst messages.db nicht mehr und der Lauf meldet
REM     faelschlich "nichts Neues". Sprachunabhaengig pruefen: auf deutschem
REM     Windows meldet netstat "ABHOEREN", ein findstr auf LISTENING trifft nie.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8080 -State Listen -EA SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Bridge war aus - wird gestartet. >> "%LOG%"
  start "" /min cmd /c "C:\Users\Hacker.HPGAME.000\Desktop\whatsappkonsole.bat"
  timeout /t 25 /nobreak >nul
) else (
  echo Bridge laeuft. >> "%LOG%"
)

REM --- Schritt 1: WhatsApp-Nachrichten abziehen. ---
REM     Kein MCP, kein LLM. 0 = Neues, 10 = heute schon gelaufen, 11 = nichts Neues.
echo --- WhatsApp --- >> "%LOG%"
"%NODE_BIN%" "%PROJECT%\scripts\whatsapp-dump.mjs" >> "%LOG%" 2>&1
set WA_RC=%ERRORLEVEL%

REM --- Schritt 2: AI-Report aus Firestore ziehen. ---
REM     0 = Report geschrieben, 12 = kein Dienstkonto hinterlegt. Bei 12 faellt
REM     nur dieser Teil aus, der WhatsApp-Teil laeuft normal weiter.
echo --- AI-Report --- >> "%LOG%"
"%NODE_BIN%" --import tsx "%PROJECT%\scripts\ai-report-dump.mts" >> "%LOG%" 2>&1
set AI_RC=%ERRORLEVEL%

REM --- Schritt 2b: Mit dem Stand des letzten Laufs vergleichen. ---
REM     0 = es gibt Aenderungen, 11 = alles unveraendert.
set DIFF_RC=99
if %AI_RC% NEQ 0 goto :nach_diff
"%NODE_BIN%" "%PROJECT%\scripts\ai-report-diff.mjs" >> "%LOG%" 2>&1
set DIFF_RC=%ERRORLEVEL%
:nach_diff

REM --- Schritt 3: Gibt es ueberhaupt etwas zu erzaehlen? ---
set RUN_WA=0
set RUN_AI=0
if %WA_RC% EQU 0 set RUN_WA=1
if %DIFF_RC% EQU 0 set RUN_AI=1

echo Ergebnis: WhatsApp=%WA_RC% AI-Report=%AI_RC% Vergleich=%DIFF_RC% >> "%LOG%"

if %RUN_WA% EQU 0 if %RUN_AI% EQU 0 (
  echo Ende: nichts Neues - weder in WhatsApp noch im Betrieb. >> "%LOG%"
  goto :abschluss
)

REM --- Schritt 4: Auswerten und Tagesnotiz schreiben. ---
REM     "call" ist Pflicht: claude.cmd ist selbst ein Batch-Skript. Ohne call
REM     uebergibt cmd die Kontrolle dorthin und kehrt NIE zurueck - Schritt 5
REM     wuerde stillschweigend nie laufen.
REM     allowedTools bewusst ohne Bash und ohne MCP: so kann der Lauf nicht an
REM     einer Freigabe haengenbleiben. "< NUL" verhindert die Eingabeumleitung.
REM     ACHTUNG: im Auftragstext duerfen keine Anfuehrungszeichen stehen, sonst
REM     bricht die Kommandozeile mittendrin ab.
set AUFTRAG=Folge der Anleitung in scripts/tageslauf.md und schreibe die Tagesnotiz oben in tagesnotiz.md.
if %RUN_WA% EQU 1 if %RUN_AI% EQU 1 set AUFTRAG=%AUFTRAG% Es gibt beides: werte whatsapp-neu.md und ai-report-neu.md aus.
if %RUN_WA% EQU 1 if %RUN_AI% EQU 0 set AUFTRAG=%AUFTRAG% Werte nur whatsapp-neu.md aus; im Betrieb hat sich nichts geaendert, also den Abschnitt Betrieb weglassen.
if %RUN_WA% EQU 0 if %RUN_AI% EQU 1 set AUFTRAG=%AUFTRAG% Werte nur ai-report-neu.md aus; WhatsApp wurde heute schon ausgewertet, also whatsapp-neu.md nicht lesen und den Abschnitt WhatsApp weglassen.
set AUFTRAG=%AUFTRAG% Gib zum Schluss eine einzeilige Zusammenfassung aus.

echo --- claude --- >> "%LOG%"
call "%CLAUDE_BIN%" -p "%AUFTRAG%" ^
  --allowedTools "Read,Write,Edit,Glob,Grep" ^
  < NUL >> "%LOG%" 2>&1

if errorlevel 1 (
  echo FEHLER: claude wurde mit Fehlercode beendet. Ist "claude login" erledigt? >> "%LOG%"
  goto :abschluss
)

REM --- Schritt 5: Staende erst JETZT fortschreiben. ---
REM     Bricht Schritt 4 ab, bleiben die alten Staende stehen und dieselben
REM     Nachrichten bzw. Aenderungen kommen beim naechsten Lauf wieder ins Delta.
if %RUN_WA% EQU 1 "%NODE_BIN%" "%PROJECT%\scripts\whatsapp-mark-scanned.mjs" >> "%LOG%" 2>&1
if %AI_RC% EQU 0 "%NODE_BIN%" "%PROJECT%\scripts\ai-report-mark-scanned.mjs" >> "%LOG%" 2>&1

:abschluss
REM --- Schritt 6: Ergebnisse in den Google-Drive-Ordner. ---
REM     Von dort liest der Drive-Connector von claude.ai sie LIVE - ohne "Sync now".
REM     ai-report-latest.json ist der komplette KI-Report - dieselbe Datei, die der
REM     Menuepunkt im Browser herunterlaedt. ai-report-neu.md ist die Aenderungsliste
REM     dazu. Laeuft auch nach einem Abbruch: hochladen schadet nie.
"%NODE_BIN%" "%PROJECT%\scripts\cloud-copy.mjs" tagesnotiz.md ai-report-latest.json ai-report-neu.md >> "%LOG%" 2>&1

REM --- Schritt 7: Kontext ins private Repo (Projekt-Wissen, braucht "Sync now"). ---
REM     Schlaegt das fehl, ist der Lauf trotzdem erfolgreich - die Leads sind schon da.
call "%PROJECT%\scripts\push-kontext.bat" >> "%LOG%" 2>&1

echo Lauf beendet. >> "%LOG%"
endlocal
