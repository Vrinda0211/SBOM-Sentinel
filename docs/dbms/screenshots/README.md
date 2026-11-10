# Live MySQL evidence checklist

No screenshots or database outputs have been generated: this checkout has no
configured MySQL credentials. Capture genuine output after configuring the
local database. Do not replace these items with mock results.

- [ ] `SHOW CREATE TABLE COMPONENT_VERSION_LICENSE`
- [ ] `SHOW CREATE VIEW V_OPEN_VULNERABILITY_FINDINGS`
- [ ] `SHOW INDEX` output for `COMPONENT` and
      `COMPONENT_VERSION_VULNERABILITY`
- [ ] Table count and seed severity/remediation counts
- [ ] `CALL SP_APPLICATION_RISK_SUMMARY(...)` output
- [ ] `EXPLAIN` output showing the reverse vulnerability index
- [ ] `npm run test:mysql:live` passing output
- [ ] Save terminal captures in this directory with the command and database
      version visible; hide usernames, hostnames if sensitive, and all
      credentials.

Setup commands:

```powershell
npm run db:init
npm run db:seed
npm run test:mysql:live
```
