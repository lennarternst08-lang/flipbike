@echo off
REM ============================================================================
REM  WhatsApp nach neuen Flyer-Leads durchsuchen.
REM  Wird von der Windows-Aufgabe "FlipBike-WhatsApp-Leads" taeglich gestartet.
REM  Ergebnis: leads-inbox.json im Projektstamm (gitignoriert!).
REM  Voraussetzung: einmalig "claude login" ausgefuehrt haben.
REM ============================================================================

setlocal
set PROJECT=C:\Users\Hacker.HPGAME.000\Downloads\remix_-fahrrad-butz-ki
set BRIDGE=C:\Users\Hacker.HPGAME.000\Desktop\whatsappkonsole.bat
set LOG=%PROJECT%\leads-inbox.log
set PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm

echo. >> "%LOG%"
echo ===== Lauf %DATE% %TIME% ===== >> "%LOG%"

REM --- Bridge starten, falls sie nicht laeuft. Sie holt beim Start die
REM     seit dem letzten Lauf aufgelaufenen Nachrichten nach. ---
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo Bridge nicht aktiv - wird gestartet. >> "%LOG%"
  start "" /min cmd /c "%BRIDGE%"
  REM 20 s Anlauf: Verbinden und Nachrichten nachladen brauchen einen Moment.
  timeout /t 20 /nobreak >nul
) else (
  echo Bridge laeuft bereits. >> "%LOG%"
)

cd /d "%PROJECT%"

claude -p "Folge exakt der Anleitung in scripts/scan-whatsapp-leads.md und durchsuche WhatsApp nach neuen Flyer-Leads. Schreibe das Ergebnis nach leads-inbox.json und aktualisiere leads-inbox.state.json. Gib zum Schluss eine einzeilige Zusammenfassung aus, wie viele Leads dazugekommen sind." ^
  --allowedTools "Read,Write,Edit,Glob,Grep,Bash(netstat:*),mcp__whatsapp__list_messages,mcp__whatsapp__list_chats,mcp__whatsapp__search_contacts,mcp__whatsapp__get_chat,mcp__whatsapp__get_contact" ^
  >> "%LOG%" 2>&1

if errorlevel 1 (
  echo FEHLER: claude wurde mit Fehlercode beendet. Ist "claude login" erledigt? >> "%LOG%"
) else (
  echo Lauf beendet. >> "%LOG%"
)

endlocal
