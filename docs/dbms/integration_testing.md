# MySQL backend integration testing

The live integration suite is
[`src/server/mysql-live.integration.test.ts`](../../src/server/mysql-live.integration.test.ts).
It imports the actual server modules and `getMySqlPool`; it mocks only the
Next.js `server-only` marker, not the database. Test rows use generated IDs
and a distinctive test description, and cleanup deletes only the test
application, its components, vulnerabilities, and licenses.

The test exercises:

- `createSbom`, `createComponent`, `addComponentVersion`,
  `addSbomComponent`, `addDependency`, and `getSbomGraphData`.
- Duplicate version, association, dependency, and UUID (including uppercase
  UUID) handling.
- Invalid foreign keys, self-dependency, duplicate SBOM input, and rollback.
- Legacy and junction-table license reads, vulnerability association, graph
  node/edge results, and the stored risk summary.

Run the dedicated live suite after configuring `.env` and initializing the
selected local test database:

```powershell
npm run db:init
npm run test:mysql:live
```

It does not create or drop a database. It creates unique records in the
configured database and removes only those records in `afterEach`. The full
`npm test -- --run` suite skips these live cases when MySQL environment
variables are absent; `npm run test:mysql:live` instead fails before tests
start if required connection settings are missing.

## Recorded verification

The full repository unit run completed with **11 test files and 97 tests
passing**; the live MySQL suite was **skipped** because the required connection
environment was absent. Those passing unit tests use mocked MySQL pools and
are not live DB evidence. The dedicated live command was attempted and correctly stopped
before opening a connection because the required settings were unavailable.
Typecheck and lint both completed successfully.

Current environment check: Windows service `MySQL80` is running and the local
MySQL port is open, but no `.env` or `MYSQL_*` connection settings are
available. Therefore this document intentionally includes no fabricated
live test output.

See [`screenshots/README.md`](screenshots/README.md) for the evidence capture
checklist.
