import { Suspense } from "react";
import { connection } from "next/server";
import Dashboard from "./dashboard";
import { loadDashboardDataAction } from "./actions";

async function DashboardContent() {
  await connection();

  let initialData: Awaited<ReturnType<typeof loadDashboardDataAction>> | null =
    null;
  let initialError: string | null = null;
  try {
    initialData = await loadDashboardDataAction();
  } catch {
    initialError =
      "The database query failed. Check that MySQL is configured and available.";
  }
  return <Dashboard initialData={initialData} initialError={initialError} />;
}

function DashboardLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading SBOM dashboard"
      className="mx-auto w-full max-w-7xl space-y-6 px-5 py-8 sm:px-8"
    >
      <p className="text-sm font-medium text-emerald-800">Project workspace</p>
      <h1 className="text-3xl font-bold tracking-tight text-slate-950">
        SBOM dashboard
      </h1>
      <p className="text-sm text-slate-600" role="status">
        Loading live dashboard data from MySQL...
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {["Applications", "Components", "Open findings"].map((label) => (
          <section
            aria-label={label}
            className="animate-pulse rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            key={label}
          >
            <p className="text-sm font-medium text-slate-600">{label}</p>
            <div className="mt-3 h-8 w-16 rounded bg-slate-200" />
          </section>
        ))}
      </div>
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}
