export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-20 sm:px-10">
      <div className="mb-8 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-900 text-lg font-bold text-white"
        >
          S
        </span>
        <span className="text-sm font-semibold tracking-wide text-emerald-950">
          SBOM SENTINEL
        </span>
      </div>

      <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800">
        Software supply-chain intelligence
      </p>
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
        Understand what your software depends on.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700">
        SBOM Sentinel is a team project to help developers organize software
        components, dependency relationships, licenses, and vulnerability
        information across their applications.
      </p>

      <section
        aria-labelledby="architecture-heading"
        className="mt-14 grid gap-4 border-t border-slate-300 pt-8 sm:grid-cols-2"
      >
        <h2 id="architecture-heading" className="sr-only">
          Planned architecture
        </h2>
        <article className="rounded-2xl border border-slate-200 bg-white/70 p-6">
          <p className="text-sm font-semibold text-emerald-900">
            Structured data
          </p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">
            PostgreSQL + Prisma
          </h3>
          <p className="mt-2 leading-7 text-slate-700">
            Planned for applications, components, versions, licenses, and
            vulnerability records.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white/70 p-6">
          <p className="text-sm font-semibold text-emerald-900">
            Dependency relationships
          </p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">Neo4j</h3>
          <p className="mt-2 leading-7 text-slate-700">
            Planned for dependency graphs and application impact exploration.
          </p>
        </article>
      </section>

      <p className="mt-8 text-sm text-slate-600">
        Development foundation only. Database services, schemas, and product
        features are not implemented yet.
      </p>
    </main>
  );
}
