# MILO Sicherheitskorrekturen: vorbereiteter Stand vom 30.09.2026

## Nachprüfung am 01.10.2026

- Separates Projekt `MILO Sicherheitstest` in Organisation `Otter`, Frankfurt, PostgreSQL 17.11.0.002. Die Supabase-Kostenabfrage nennt 0 monatlich; kein Tarifwechsel vorgenommen.
- Datenbankstruktur und Sicherheitskorrekturen dort eingerichtet, Edge Function dort bereitgestellt. Nur synthetische Schüler-/Benutzerkonten; keine Datenkopie des laufenden Projekts.
- 19 echte HTTP-Prüfungen bestanden: Auth-Passwortanmeldung, REST-RLS, Adminhash-Schutz, Edge-Berechtigungsprüfung ohne Mailversand, QR-Kopplung, Zugriffsentzug nach Rotation und Schulentfernung mit bereits ausgestellten JWTs.
- Die anonymen Testkonten wurden serverseitig als künstliche Fixtures angelegt und erhielten echte Auth-JWTs. Die erstmalige anonyme Registrierung ist im neuen Projekt noch deaktiviert. Dieser Teil des QR-Onboardings bleibt ausdrücklich ungetestet. Reale Einladungsmails und Safari/iPad-Hardware ebenfalls offen.
- Vertraulicher Export vom 30.09.: 28 Anwendungstabellen plus Auth-Benutzer/Identitäten, 284 Zeilen. Archivintegrität und 45 Fremdschlüsselbeziehungen geprüft. Keine Recovery-/Bestätigungstoken oder Sitzungen exportiert. Kein vollständiger Supabase-Projektdump und noch kein vollständiger Auth-Wiederherstellungstest. Der Export liegt ausdrücklich außerhalb dieses öffentlichen Repositories.

Reproduzierbarer Test: `MILO_STAGING_CONFIG=/geschuetzter/pfad/config.json node tests/staging-http.mjs`. Die lokale Konfiguration enthält `url`, Publishable-`key` und das ausschließlich für synthetische Konten verwendete `password`. Niemals in Git einchecken. Der Runner verweigert das produktive Projekt und versendet keine E-Mails.

**Nicht live veröffentlicht.** Ausgangspunkt: `3c0397396a78608894694073d09ee3f460185a17`.
Produktionsdatenbank, Konten, QR-Karten und GitHub-Pages-Deployment sind unverändert.

## Änderungen und Nachweise

| Befund | Vorbereitete Korrektur | Prüfung / verbleibende Grenze |
| --- | --- | --- |
| A01 Rollenvergabe | Neue Profile erhalten unabhängig von Benutzermetadaten keine Lehrkraftrolle. Lehrkraftrechte verlangen ein nicht anonymes Konto sowie bestehende Schulmitgliedschaft oder eine bestehende eigenständige Klasse. Provisionierung an anonyme Konten wird auch in der DB verhindert. | Registrierungsmetadaten, anonyme und normale unfreigegebene Konten sowie vorhandene Lehrkräfte lokal geprüft. Bestehende Rollen werden nicht pauschal gelöscht. |
| A02 Einladungen | Schuladmin und Klassen-/Stufenzuordnung werden vor Auth-Admin-Kontosuche und E-Mail-Einladung geprüft. | Vier isolierte Edge-Tests, einschließlich erlaubter Einladung. Kein realer Mailversand. Rate-Limits bleiben Betriebsaufgabe. |
| A03 Rechteentzug | Stufenrechte erfordern aktuelle Mitgliedschaft. Schulklassenrechte beruhen auf expliziten Klassenlinks, nicht allein auf historischem Eigentümer. Bestehende berechtigte Eigentümer werden migrationssicher übernommen. Schulentfernung entfernt Klassen-/Stufenlinks und überträgt Eigentümerschaft. Direkte Klassenänderungen können diese Logik nicht umgehen. | Negative Lese-/Schreibtests nach Klassen- und Schulentfernung bestanden. Stufenrechte bleiben bei reiner Klassenentfernung bewusst separat; Schulentfernung entzieht beides. |
| A04 Logout und Gerätespeicher | Zentrale Bereinigung sämtlicher App-Zustände und DOM-Inhalte, Abbruch laufender Requests, Leeren von Passwörtern und Adminflags. Auth-Speicherung nur pro Tab. Neue Offline-Notiz-/Bewertungsablagen deaktiviert. Eigene Notizvorlagen in einer RLS-geschützten Tabelle. | Browsertests mit synthetischen Namen, Notizen, QR-Werten und Passwörtern. Altbestände anderer Konten auf bestehenden Geräten werden nicht still gelöscht. Deren kontrollierte Übernahme/Bereinigung ist vor echtem Betrieb erforderlich. Kein Schutzversprechen gegen Schadsoftware oder fremdes JavaScript derselben Origin. |
| A05 QR-URLs | Neue Karten verwenden `#child=…`, keine Token im HTTP-Query. Sofortige Adressbereinigung vor externen Ressourcen und `no-referrer`. Legacy-Karten werden weiterhin gelesen, damit die Umstellung kontrolliert erfolgen kann. QR-Reset sperrt Geräte und alte Codes; Gerätesperre deaktiviert auch Karten. | Token-Normalisierung, URL-Bereinigung, Reset/Widerruf und archivierte Kinder geprüft. Alte ausgedruckte Query-Karten bleiben ein Übergangsrisiko und müssen vor realer Nutzung ersetzt werden. |
| A06 Sprachverarbeitung | Diktat und Vorlesen technisch deaktiviert, Buttons ausgeblendet. | Funktionsaufrufe starten keine Sprach-API. Keine Audioübertragung getestet oder ausgelöst. |
| B01 Adminhash | SELECT nur für ausdrücklich freigegebene Settings-Spalten. Hash bleibt unverändert gespeichert und ausschließlich über privilegierte Verifikationsfunktion verwendbar. Frontend fragt sichere Spalten ausdrücklich ab. | Admin und Lehrkraft können den Hash und `select *` nicht lesen; Kennwortprüfung funktioniert. Das zusätzliche UI-Kennwort ist weiterhin keine echte MFA. |

Zusätzlich: Die eingesetzte Supabase-JS-Version ist fest auf 2.117.2 gesetzt. Pages veröffentlicht künftig nur Browserressourcen, keine SQL-Dateien, Testquellen oder Dokumentation. Service Worker erhält eine neue Cacheversion.

## Tests

`npm ci` und `npm test` führen 14 Tests aus: zehn PostgreSQL-Tests und vier Edge-Tests.
Die lokale Testdatenbank verwendet PostgreSQL 18.3 via PGlite 0.5.8. Sie rekonstruiert Tabellen, Constraints, RLS, Funktionsdefinitionen, Trigger und Rechte des geprüften Snapshots. Es werden ausschließlich künstliche Konten und Kinder eingefügt. Produktiv läuft PostgreSQL 17; ein finaler Test auf einem vollständigen Supabase-17-Testsystem ist noch offen.

`npm run preview:test` startet eine rein lokale Vorschau mit Auth-/API-Mocks. Sie sendet keine Anmeldungen oder Schreibvorgänge an Supabase. In einem zweiten Terminal führt `npm run test:browser` die Browserchecks aus. Falls nötig vorher `npx playwright install chromium`; optional kann `MILO_BROWSER_PATH` auf ein vorhandenes Chromium zeigen.

Geprüfte Browsergrößen: 1440×1000, 820×1180, 1180×820. Login, kein horizontaler Überlauf, Logout, Sitzungsablauf, QR-URL und deaktivierte Sprache bestanden. Screenshots wurden visuell geprüft. Dies ist **keine Prüfung auf einem echten iPad/Safari und kein vollständiger Supabase-Auth-End-to-End-Test**. Der agent-browser-Daemon startete in der Arbeitsumgebung nicht; die Browserprüfungen wurden mit Playwright/Chromium ausgeführt.

## Sicherung und Datenbestand

- Der unveränderte Git-Ausgangspunkt bleibt in der Commit-Historie erhalten; zusätzlich wurde ein vollständiges lokales Git-Bundle erstellt.
- `supabase/baseline/catalog.json` sichert den aktuellen relevanten Schemakatalog einschließlich installierter Funktionen und Policies. Keine Schülerzeilen, Zugangscodes oder Kennworthashes sind darin enthalten. Dieser Katalog ist Testgrundlage und kein vollständiger Daten-/Auth-Backupdump.
- Die Migration verändert keine Bewertungen, Ziele, Wochenhistorien oder Notizen. Ein synthetischer Wochenplan bleibt im Vorher-/Nachher-Vergleich identisch.
- Vor einer späteren Live-Migration ist ein aktuelles, geprüftes Datenbank-/Auth-Backup erforderlich. Das wurde in diesem Durchgang nicht als vorhanden oder wiederherstellbar bestätigt.

## Umstellung erst nach ausdrücklicher Freigabe

1. Supabase-Konfiguration und aktuellen Schema-/Versionsstand erneut prüfen. Daten-/Auth-Backup sowie Wiederherstellungsmöglichkeit nachweisen. Keine geheimen Schlüssel in Git oder Screenshots ablegen.
2. Vollständigen Supabase-Test mit den neuen DB-Funktionen und der Edge Function ausführen: echte Testeinladung, Annahme, Lehrkraftanmeldung, anonyme QR-Anmeldung und zwei getrennte Schülergeräte. Aktuelle Lehrkraft-/Adminliste auf gewünschte Rechte prüfen.
3. Lokale Altbestände auf bisher verwendeten Geräten kontrollieren. Der neue Übernahmepfad verarbeitet nur Daten des angemeldeten Kontos und löscht Einträge erst nach bestätigtem Servererfolg. Alte Bewertungswarteschlangen können aktuelle Werte überschreiben; deshalb verlangt die Übernahme eine ausdrückliche Bestätigung. Bei unbekannten alten Konten keine pauschale Browserlöschung vor Datensicherung.
4. In einem abgestimmten Wartungsfenster Frontend und Migration gemeinsam umstellen: alte Seite verwendet `school_settings.select('*')` und ist nach Spaltenhärtung nicht vollständig kompatibel. Migration `20260930082816_prelaunch_security_hardening.sql` und `manage-teacher-account` bereitstellen, dann das neue Frontend ausrollen. Die Migration ist transaktional und nur einmal anzuwenden.
5. Service-Worker-Aktualisierung und neue Datei `security.js` auf jedem Testgerät prüfen. Einmal neu anmelden. Noch geöffnete alte Tabs schließen. Neue Tab-Sitzungen und gespeicherte Browserdaten auf gemeinsam verwendeten Geräten bewusst handhaben.
6. QR-Codes kontrolliert erneuern und **neue Karten drucken**. Reset trennt bereits gekoppelte Geräte. Alte Karten einsammeln. Neue Fragmentkarten mit iPhone-/iPad-Kamera und internem Scanner prüfen. Niemand muss Codes oder Passwörter an den Entwickler senden.
7. Einladungen, Rechteentzug, Logout, Stundenplanbewertung und Wochenbelohnung nochmals mit Testdaten prüfen. Erst danach zusammen mit Schulleitung/Datenschutzstelle über echte Daten entscheiden.

Keine dieser Live-Aktionen wurde bereits ausgeführt. Eine Freigabe dieses Codes ersetzt die offenen organisatorischen Voraussetzungen nicht.

## Rücknahme

Bei SQL-Fehlern vor COMMIT wird die Migration zurückgerollt. Nach erfolgreicher Einführung nicht einfach alte Frontend-Dateien zurückspielen: deren Settingsabfragen sind inkompatibel. Bei Problemen Betrieb mit echten Daten anhalten, Fehler gezielt korrigieren oder aus geprüftem Backup wiederherstellen. Bereits entzogene Rechte und rotierte QR-Codes sollen nicht unbemerkt reaktiviert werden. Die neue Vorlagentabelle bei einer Rücknahme nicht löschen, solange dort Daten liegen.

## Weitere offene Auditpunkte

B01 MFA/Passwortwechsel, B03 Aufbewahrung/Löschung, B04 Datenminimierung, B05 Wochenintegrität, B06 Stundenplanrechte/Abwesenheit, B07 CSP/weitere Drittanbieter, B08 KI, B09 Elternpfade, B10 schulübergreifende Provisionierung, B11 Logging und B12 Betriebsnachweise sind durch diesen begrenzten Auftrag nicht vollständig erledigt. KI bleibt deaktiviert. Insbesondere aus dem Bestehen der lokalen Tests folgt noch keine Freigabe für echte Schülerdaten.
