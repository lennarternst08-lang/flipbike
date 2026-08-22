' Startet eine Batchdatei OHNE sichtbares Fenster.
'
' Warum es das gibt: der Taskplaner startet .bat-Dateien immer mit einem eigenen
' Konsolenfenster. Bei "FlipBike-WhatsApp-Sync" (alle 15 Minuten) blitzte dadurch
' den ganzen Tag ein CMD-Fenster auf und nahm den Fokus. Ein "Hidden"-Haken in der
' Aufgabe hilft nicht - der versteckt nur den Eintrag in der Aufgabenliste.
'
' Aufruf aus der Aufgabe heraus:
'   wscript.exe "...\scripts\lauf-versteckt.vbs" "...\scripts\sync-whatsapp-files.bat"
'
' Der Rueckgabewert der Batchdatei wird durchgereicht, damit der Taskplaner
' weiterhin Erfolg und Fehler unterscheiden kann.
'
' Falls Windows VBScript irgendwann entfernt (angekuendigt als "Feature on Demand"),
' laufen die Aufgaben nicht mehr. Dann in der Aufgabe einfach wieder direkt die
' .bat eintragen - sichtbar, aber funktionierend.

Option Explicit

Dim sh, i, befehl

If WScript.Arguments.Count = 0 Then
  WScript.Quit 2
End If

Set sh = CreateObject("WScript.Shell")

befehl = """" & WScript.Arguments(0) & """"
For i = 1 To WScript.Arguments.Count - 1
  befehl = befehl & " """ & WScript.Arguments(i) & """"
Next

' 0 = Fenster unsichtbar, True = warten (sonst meldet der Taskplaner sofort "fertig")
WScript.Quit sh.Run(befehl, 0, True)
