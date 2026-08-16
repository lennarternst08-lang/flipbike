@echo off
REM ============================================================================
REM  Schiebt whatsapp-context.md ins private Repo flipbike-kontext, damit das
REM  Claude-Projekt "Fahrrad Business" es ueber die GitHub-Integration sieht.
REM
REM  ACHTUNG: Zielrepo muss privat bleiben - die Datei enthaelt Namen, Adressen
REM  und private Unterhaltungen. Niemals ins oeffentliche flipbike-Repo.
REM
REM  claude.ai synchronisiert NICHT von selbst: im Projekt muss nach einer
REM  Aenderung einmal auf "Sync now" geklickt werden.
REM ============================================================================

setlocal
set PROJEKT=C:\Users\Hacker.HPGAME.000\Downloads\remix_-fahrrad-butz-ki
set KONTEXT=C:\Users\Hacker.HPGAME.000\Downloads\flipbike-kontext
set GIT_BIN=C:\Program Files\Git\cmd\git.exe

if not exist "%PROJEKT%\whatsapp-context.md" (
  echo Kontextdatei fehlt - nichts zu pushen.
  exit /b 0
)
if not exist "%KONTEXT%\.git" (
  echo Ablage %KONTEXT% fehlt oder ist kein Repo - uebersprungen.
  exit /b 0
)

copy /Y "%PROJEKT%\whatsapp-context.md" "%KONTEXT%\whatsapp-context.md" >nul
REM Die Tagesnotiz ist die eigentlich interessante Datei - kurz und handlungsrelevant.
if exist "%PROJEKT%\whatsapp-zusammenfassung.md" (
  copy /Y "%PROJEKT%\whatsapp-zusammenfassung.md" "%KONTEXT%\whatsapp-zusammenfassung.md" >nul
)
cd /d "%KONTEXT%"

REM Nichts geaendert? Dann auch kein leerer Commit.
"%GIT_BIN%" diff --quiet
if not errorlevel 1 (
  echo Kontext unveraendert - kein Push noetig.
  exit /b 0
)

"%GIT_BIN%" add -A
"%GIT_BIN%" -c user.email="lennarternst08@gmail.com" -c user.name="FlipBike Automation" commit -q -m "Kontext aktualisiert"
"%GIT_BIN%" push -q origin HEAD
if errorlevel 1 (
  echo FEHLER: Push fehlgeschlagen.
  exit /b 1
)
echo Kontext gepusht - im Claude-Projekt einmal "Sync now" klicken.
endlocal
