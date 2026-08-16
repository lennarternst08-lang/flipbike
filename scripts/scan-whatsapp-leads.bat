@echo off
REM ============================================================================
REM  WhatsApp nach neuen Flyer-Leads durchsuchen.
REM  Wird von der Windows-Aufgabe "FlipBike-WhatsApp-Leads" bei der Anmeldung
REM  gestartet (hoechstens ein Lauf pro Tag - der Waechter steckt im Node-Skript).
REM
REM  Die Bridge wird hier NICHT mehr gestartet: das erledigt die eigene Aufgabe
REM  "FlipBike-WhatsApp-Bridge", die dauerhaft laeuft. Genau dieser Schritt war
REM  frueher die Fehlerquelle.
REM
REM  Ergebnis: leads-inbox.json (gitignoriert). Voraussetzung: einmalig "claude login".
REM ============================================================================

setlocal
set PROJECT=C:\Users\Hacker.HPGAME.000\Downloads\remix_-fahrrad-butz-ki
set NODE_BIN=C:\Program Files\nodejs\node.exe
set LOG=%PROJECT%\leads-inbox.log

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
echo ===== Lauf %DATE% %TIME% ===== >> "%LOG%"
echo claude: %CLAUDE_BIN% >> "%LOG%"

REM --- Schritt 1: Nachrichten direkt aus der Bridge-Datenbank abziehen. ---
REM     Kein MCP, kein LLM. Exit-Code steuert, ob es ueberhaupt weitergeht.
"%NODE_BIN%" "%PROJECT%\scripts\whatsapp-dump.mjs" >> "%LOG%" 2>&1
set DUMP_RC=%ERRORLEVEL%

REM Achtung: "if errorlevel N" trifft auf ">= N" zu -> absteigend pruefen.
if %DUMP_RC% EQU 11 (
  echo Ende: keine neuen Nachrichten. >> "%LOG%"
  goto :done
)
if %DUMP_RC% EQU 10 (
  echo Ende: heute schon gelaufen. >> "%LOG%"
  goto :done
)
if %DUMP_RC% NEQ 0 (
  echo FEHLER: Abzug fehlgeschlagen ^(Code %DUMP_RC%^). >> "%LOG%"
  goto :done
)

REM --- Schritt 2: Nur den Zuwachs auswerten lassen. ---
REM     "call" ist Pflicht: claude.cmd ist selbst ein Batch-Skript. Ohne call
REM     uebergibt cmd die Kontrolle dorthin und kehrt NIE zurueck - Schritt 3
REM     wuerde stillschweigend nie laufen.
REM     allowedTools bewusst ohne Bash und ohne MCP: so kann der Lauf nicht an
REM     einer Freigabe haengenbleiben. "< NUL" verhindert die Eingabeumleitung.
call "%CLAUDE_BIN%" -p "Folge der Anleitung in scripts/scan-whatsapp-leads.md. Werte ausschliesslich whatsapp-neu.md aus, trage neue Leads in leads-inbox.json ein und schreibe die Tagesnotiz oben in whatsapp-zusammenfassung.md. Gib zum Schluss eine einzeilige Zusammenfassung aus." ^
  --allowedTools "Read,Write,Edit,Glob,Grep" ^
  < NUL >> "%LOG%" 2>&1

if errorlevel 1 (
  echo FEHLER: claude wurde mit Fehlercode beendet. Ist "claude login" erledigt? >> "%LOG%"
  goto :done
)

REM --- Schritt 3: Stand erst JETZT fortschreiben. ---
REM     Bricht Schritt 2 ab, bleibt der alte Stand stehen und dieselben
REM     Nachrichten kommen beim naechsten Lauf wieder ins Delta.
"%NODE_BIN%" "%PROJECT%\scripts\whatsapp-mark-scanned.mjs" >> "%LOG%" 2>&1

REM --- Schritt 4: Kontext ins private Repo, damit das Claude-Projekt ihn sieht. ---
REM     Schlaegt das fehl, ist der Lauf trotzdem erfolgreich - die Leads sind schon da.
call "%PROJECT%\scripts\push-kontext.bat" >> "%LOG%" 2>&1

echo Lauf beendet. >> "%LOG%"

:done
endlocal
