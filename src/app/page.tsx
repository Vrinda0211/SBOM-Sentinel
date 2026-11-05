import Link from "next/link";

const sections = [
  "Applications",
  "SBOM management",
  "Component inventory",
  "Vulnerabilities",
  "Dependency explorer",
];

const metrics = [
  "Applications",
  "Components",
  "Open vulnerabilities",
];

const severities = ["Critical", "High", "Medium", "Low"];

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-900 text-lg font-bold text-white"
          >
            S
          </span>
          <div>
            <p className="text-sm font-bold tracking-wide text-slate-950">
              SBOM SENTINEL
            </p>
            <p className="text-xs text-slate-500">Supply-chain intelligence</p>
          </div>
        </div>

        <nav aria-label="Main navigation" className="flex-1 px-4 py-6">
          <p className="px-3 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <Link
            aria-current="page"
            className="flex items-center gap-3 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-900"
            href="/"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-700" />
            Dashboard
          </Link>
          <p className="px-3 pb-2 pt-8 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Product areas
          </p>
          <ul className="space-y-1">
            {sections.map((section) => (
              <li key={section}>
                <span
                  aria-disabled="true"
                  className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-slate-500"
                  title="Available after database integration"
                >
                  {section}
                  <span className="text-xs text-slate-400">Soon</span>
                </span>
              </li>
            ))}
          </ul>
        </nav>

        <div className="m-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold text-slate-700">
            Database connections
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Connection status has not been verified.
          </p>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-64">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
            <div className="lg:hidden">
              <p className="text-sm font-bold tracking-wide text-emerald-950">
                SBOM SENTINEL
              </p>
              <p className="text-xs text-slate-500">
                Software supply-chain intelligence
              </p>
            </div>
            <p className="hidden text-sm text-slate-500 lg:block">
              Workspace overview
            </p>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
              Connection unverified
            </span>
          </div>
          <nav
            aria-label="Mobile navigation"
            className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3 lg:hidden"
          >
            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900">
              Dashboard
            </span>
            {sections.map((section) => (
              <span
                aria-disabled="true"
                className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500"
                key={section}
              >
                {section}
              </span>
            ))}
          </nav>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          <section aria-labelledby="dashboard-heading">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-medium text-emerald-800">
                  Software supply-chain intelligence
                </p>
                <h1
                  className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl"
                  id="dashboard-heading"
                >
                  Dashboard
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  A clear view of your applications, components, and
                  vulnerability exposure.
                </p>
              </div>
              <span className="text-sm text-slate-500">
                Live metrics will appear after database integration.
              </span>
            </div>

            <dl className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {metrics.map((metric) => (
                <div
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                  key={metric}
                >
                  <dt className="text-sm font-medium text-slate-600">
                    {metric}
                  </dt>
                  <dd className="mt-3 text-3xl font-semibold tracking-tight text-slate-300">
                    —
                  </dd>
                  <p className="mt-2 text-xs text-slate-500">
                    Waiting for MySQL data
                  </p>
                </div>
              ))}
            </dl>

            <div className="mt-5 grid gap-5 xl:grid-cols-3">
              <section
                aria-labelledby="severity-heading"
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2"
              >
                <div>
                  <h2
                    className="text-base font-semibold text-slate-900"
                    id="severity-heading"
                  >
                    Vulnerability severity
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Findings by severity across your applications
                  </p>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {severities.map((severity) => (
                    <div
                      className="rounded-lg border border-slate-100 bg-slate-50 p-4"
                      key={severity}
                    >
                      <p className="text-sm text-slate-600">{severity}</p>
                      <p className="mt-2 text-xl font-semibold text-slate-300">
                        —
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Not loaded
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section
                aria-labelledby="activity-heading"
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <h2
                  className="text-base font-semibold text-slate-900"
                  id="activity-heading"
                >
                  Recent activity
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Latest changes across the workspace
                </p>
                <div className="mt-6 rounded-lg border border-dashed border-slate-200 px-4 py-7 text-center">
                  <p className="text-sm font-medium text-slate-700">
                    No activity loaded
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Activity will show here when application data is connected.
                  </p>
                </div>
              </section>
            </div>

            <section
              aria-labelledby="connections-heading"
              className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <h2
                className="text-base font-semibold text-slate-900"
                id="connections-heading"
              >
                Data sources
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Connection status has not been checked by the application.
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {["MySQL", "Neo4j"].map((database) => (
                  <div
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3"
                    key={database}
                  >
                    <span className="text-sm font-medium text-slate-800">
                      {database}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      Not verified
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </div>
      </main>
    </div>
  );
}
