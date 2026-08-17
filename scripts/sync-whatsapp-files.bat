@echo off
REM ============================================================================
REM  Haelt whatsapp-neu.md und whatsapp-context.md aktuell.
REM  Wird von der Windows-Aufgabe "FlipBike-WhatsApp-Sync" alle 15 Minuten
REM  gestartet, solange der Rechner laeuft.
REM
REM  KOSTET KEINE TOKENS: hier laeuft nur der Node-Abzug aus der Bridge-Datenbank,
REM  kein Claude. Die Auswertung (Leads, Tagesnotiz) bleibt beim Tageslauf in
REM  scan-whatsapp-leads.bat.
REM
REM  Nebenbei Wachhund fuer die Bridge: ist sie tot, waechst messages.db nicht
REM  mehr und alles meldet faelschlich "nichts Neues".
REM
REM  Das Log wird bewusst UEBERSCHRIEBEN, nicht angehaengt - bei ~96 Laeufen am
REM  Tag soll daraus keine wachsende Datei werden.
REM ============================================================================

setlocal
set PROJECT=C:\Users\Hacker.HPGAME.000\Downloads\remix_-fahrrad-butz-ki
set NODE_BIN=C:\Program Files\nodejs\node.exe
set LOG=%PROJECT%\whatsapp-sync.log

cd /d "%PROJECT%"
echo ===== Sync %DATE% %TIME% ===== > "%LOG%"

REM --- Bridge am Leben halten ---
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
  echo Bridge war aus - wird gestartet. >> "%LOG%"
  start "" /min cmd /c "C:\Users\Hacker.HPGAME.000\Desktop\whatsappkonsole.bat"
  timeout /t 25 /nobreak >nul
) else (
  echo Bridge laeuft. >> "%LOG%"
)

REM --- Dateien neu schreiben. --force uebergeht den Tageswaechter und laesst
REM     den Scan-Stand unberuehrt - der Tageslauf entscheidet weiterhin allein,
REM     was schon ausgewertet wurde.
"%NODE_BIN%" "%PROJECT%\scripts\whatsapp-dump.mjs" --force >> "%LOG%" 2>&1

endlocal
