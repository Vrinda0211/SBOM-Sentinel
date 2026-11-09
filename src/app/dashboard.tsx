"use client";

import { useState, useTransition } from "react";
import {
  analyzeDependenciesAction,
  loadApplicationSbomsAction,
  loadDashboardDataAction,
  loadSbomDetailsAction,
  retrySbomGraphSyncAction,
  uploadSbomAction,
} from "./actions";

type DashboardData = Awaited<ReturnType<typeof loadDashboardDataAction>>;
type ApplicationSboms = Awaited<ReturnType<typeof loadApplicationSbomsAction>>;
type SbomDetails = Awaited<ReturnType<typeof loadSbomDetailsAction>>;
type UploadResult = Awaited<ReturnType<typeof uploadSbomAction>>;
type Analysis = Awaited<ReturnType<typeof analyzeDependenciesAction>>;

interface DashboardProps {
  initialData: DashboardData | null;
  initialError: string | null;
}

const panelClass =
  "rounded-xl border border-slate-200 bg-white p-5 shadow-sm";
const fieldClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

function formatDate(value: string | null): string {
  if (!value) {
    return "Not provided";
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString();
}

function GraphVisualization({
  details,
  onSelect,
}: {
  details: SbomDetails;
  onSelect: (id: string) => void;
}) {
  const graph = details.graph;
  if (!graph) {
    return (
      <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
        {details.graphError
          ? "Neo4j dependency data is unavailable."
          : "No dependency graph is recorded for this application yet."}
      </p>
    );
  }

  const versions = graph.nodes.filter(
    (node) => node.kind === "ComponentVersion",
  );
  if (versions.length === 0) {
    return (
      <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
        This application has no component versions in the graph yet.
      </p>
    );
  }

  const positions = new Map(
    versions.map((node, index) => [
      node.data.component_version_id,
      {
        x: 120 + (index % 2) * 360,
        y: 55 + Math.floor(index / 2) * 100,
      },
    ]),
  );
  const componentNames = new Map(
    details.components.map((component) => [component.id, component.name]),
  );
  const edges = graph.edges.filter((edge) => edge.type === "DEPENDS_ON");
  const svgHeight = Math.max(130, Math.ceil(versions.length / 2) * 100 + 35);

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
      <svg
        aria-label="Neo4j component version dependency graph"
        className="min-w-[700px]"
        height={svgHeight}
        role="img"
        viewBox={`0 0 720 ${svgHeight}`}
        width="100%"
      >
        <defs>
          <marker
            id="dependency-arrow"
            markerHeight="8"
            markerWidth="8"
            orient="auto"
            refX="7"
            refY="4"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="#047857" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const source = positions.get(edge.sourceId);
          const target = positions.get(edge.targetId);
          if (!source || !target) {
            return null;
          }
          return (
            <line
              key={`${edge.sourceId}:${edge.targetId}`}
              markerEnd="url(#dependency-arrow)"
              stroke="#047857"
              strokeWidth="2"
              x1={source.x}
              x2={target.x}
              y1={source.y}
              y2={target.y}
            />
          );
        })}
        {versions.map((node) => {
          const position = positions.get(node.data.component_version_id);
          if (!position) {
            return null;
          }
          const name =
            componentNames.get(node.data.component_version_id) ??
            node.data.component_version_id.slice(0, 8);
          return (
            <g
              className="cursor-pointer"
              key={node.data.component_version_id}
              onClick={() => onSelect(node.data.component_version_id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  onSelect(node.data.component_version_id);
                }
              }}
            >
              <rect
                fill="white"
                height="54"
                rx="9"
                stroke="#cbd5e1"
                width="220"
                x={position.x - 100}
                y={position.y - 27}
              />
              <text
                fill="#0f172a"
                fontSize="12"
                textAnchor="middle"
                x={position.x + 10}
                y={position.y - 2}
              >
                {`${name} ${node.data.version_number}`.slice(0, 34)}
              </text>
              <text
                fill="#64748b"
                fontSize="9"
                textAnchor="middle"
                x={position.x + 10}
                y={position.y + 14}
              >
                {node.data.component_version_id.slice(0, 8)}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-xs text-slate-500">
        Arrows point from a dependent version to the version it requires. Select
        a node to analyze its impact.
        {graph.truncated ? " The graph is truncated to the configured result limit." : ""}
      </p>
    </div>
  );
}

export default function Dashboard({
  initialData,
  initialError,
}: DashboardProps) {
  const [data, setData] = useState(initialData);
  const [dashboardError, setDashboardError] = useState(initialError);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState("");
  const [applicationSboms, setApplicationSboms] =
    useState<ApplicationSboms | null>(null);
  const [selectedSbomId, setSelectedSbomId] = useState("");
  const [details, setDetails] = useState<SbomDetails | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [targetVersionId, setTargetVersionId] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runOperation(operation: () => Promise<void>) {
    setOperationError(null);
    startTransition(async () => {
      try {
        await operation();
      } catch (error) {
        setOperationError(
          error instanceof TypeError
            ? error.message
            : "The operation could not complete. Check database connectivity and retry.",
        );
      }
    });
  }

  function submitUpload(formData: FormData) {
    runOperation(async () => {
      setUploadResult(null);
      const result = await uploadSbomAction(formData);
      setUploadResult(result);
      if (result.ok) {
        setSelectedApplicationId(result.imported.applicationId);
        try {
          const [dashboard, sboms, sbomDetails] = await Promise.all([
            loadDashboardDataAction(),
            loadApplicationSbomsAction(result.imported.applicationId),
            loadSbomDetailsAction(result.imported.sbomId),
          ]);
          setData(dashboard);
          setApplicationSboms(sboms);
          setSelectedSbomId(result.imported.sbomId);
          setDetails(sbomDetails);
          setSelectedVersionId(sbomDetails.components[0]?.id ?? "");
          setDashboardError(null);
        } catch {
          setDashboardError(
            "The SBOM was imported, but dashboard data could not be refreshed.",
          );
        }
      }
    });
  }

  function loadApplication(applicationId: string) {
    setSelectedApplicationId(applicationId);
    setSelectedSbomId("");
    setDetails(null);
    setAnalysis(null);
    if (!applicationId) {
      setApplicationSboms(null);
      return;
    }
    setApplicationSboms(null);
    runOperation(async () => {
      setApplicationSboms(
        await loadApplicationSbomsAction(applicationId),
      );
    });
  }

  function loadSbom(sbomId: string) {
    setSelectedSbomId(sbomId);
    setDetails(null);
    setAnalysis(null);
    if (!sbomId) {
      return;
    }
    runOperation(async () => {
      const result = await loadSbomDetailsAction(sbomId);
      setDetails(result);
      if (result.components[0]) {
        setSelectedVersionId(result.components[0].id);
      }
    });
  }

  function retryGraphSync() {
    const sbomId = selectedSbomId;
    if (!sbomId) {
      return;
    }
    const currentUpload =
      uploadResult?.ok && uploadResult.imported.sbomId === sbomId
        ? uploadResult
        : null;
    runOperation(async () => {
      const result = await retrySbomGraphSyncAction(sbomId);
      if (!result.ok) {
        setOperationError(result.error);
        return;
      }
      if (currentUpload) {
        setUploadResult({
          ...currentUpload,
          graphSynced: true,
          message: "Neo4j synchronization completed.",
          graph: result.graph,
        });
      }
      setDetails(await loadSbomDetailsAction(sbomId));
    });
  }

  function analyzeVersion() {
    if (!selectedVersionId) {
      setOperationError("Select a component version to analyze.");
      return;
    }
    runOperation(async () => {
      setAnalysis(
        await analyzeDependenciesAction(
          selectedVersionId,
          targetVersionId || undefined,
        ),
      );
    });
  }

  const openFindings =
    data?.findings.filter(
      (finding) =>
        finding.remediationStatus !== "resolved" &&
        finding.remediationStatus !== "wont_fix",
    ) ?? [];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <div>
            <p className="text-sm font-bold tracking-wide text-emerald-950">
              SBOM SENTINEL
            </p>
            <p className="text-xs text-slate-500">
              Software supply-chain intelligence
            </p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900">
            MySQL source of truth · Neo4j dependency graph
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-8">
        <section>
          <p className="text-sm font-medium text-emerald-800">
            Project workspace
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
            SBOM dashboard
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Import CycloneDX or SPDX inventories, review relational findings,
            and explore version dependencies synchronized to Neo4j.
          </p>
        </section>

        {dashboardError && (
          <p
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
            role="alert"
          >
            MySQL dashboard data is unavailable: {dashboardError}
          </p>
        )}
        {operationError && (
          <p
            className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900"
            role="alert"
          >
            {operationError}
          </p>
        )}
        {isPending && (
          <p className="text-sm text-slate-600" role="status">
            Loading or processing your request…
          </p>
        )}

        <section aria-label="Database summary" className="grid gap-4 sm:grid-cols-3">
          {[
            ["Applications", data?.applications.length ?? "—"],
            ["Components", data?.components.length ?? "—"],
            ["Open findings", data ? openFindings.length : "—"],
          ].map(([label, value]) => (
            <div className={panelClass} key={label}>
              <p className="text-sm font-medium text-slate-600">{label}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">
                {value}
              </p>
            </div>
          ))}
        </section>

        <section aria-labelledby="upload-heading" className={panelClass}>
          <h2 className="text-lg font-semibold text-slate-950" id="upload-heading">
            Upload an SBOM
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            JSON only, up to 5 MB. Relational import is transactional; Neo4j
            synchronization can be retried if the graph service is unavailable.
          </p>
          <form
            className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const formData = new FormData(form);
              const file = formData.get("sbomFile");
              if (!(file instanceof File) || file.size === 0) {
                setUploadResult({
                  ok: false,
                  error: "Choose a non-empty JSON SBOM file.",
                });
                return;
              }
              if (file.size > 5 * 1024 * 1024) {
                setUploadResult({
                  ok: false,
                  error: "SBOM files must not exceed 5 MB.",
                });
                return;
              }
              submitUpload(formData);
              form.reset();
            }}
          >
            <label className="text-sm font-medium text-slate-700">
              SBOM file
              <input
                accept=".json,application/json"
                className={fieldClass}
                name="sbomFile"
                required
                type="file"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Optional application name override
              <input
                className={fieldClass}
                maxLength={255}
                name="applicationName"
                placeholder="Application name"
                type="text"
              />
            </label>
            <button
              className="self-end rounded-lg bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-wait disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Processing…" : "Import SBOM"}
            </button>
          </form>

          {uploadResult && (
            <div
              className={`mt-4 rounded-lg border p-4 text-sm ${
                uploadResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
              role={uploadResult.ok ? "status" : "alert"}
            >
              <p className="font-semibold">
                {uploadResult.ok ? uploadResult.message : uploadResult.error}
              </p>
              {uploadResult.ok && (
                <p className="mt-1">
                  {uploadResult.imported.format} ·{" "}
                  {uploadResult.imported.componentVersionCount} component
                  versions · {uploadResult.imported.dependencyCount} dependency
                  edges · SBOM ID {uploadResult.imported.sbomId}
                </p>
              )}
              {uploadResult.ok && !uploadResult.graphSynced && (
                <button
                  className="mt-3 rounded-md border border-emerald-800 px-3 py-1.5 font-semibold hover:bg-emerald-100"
                  disabled={isPending}
                  onClick={retryGraphSync}
                  type="button"
                >
                  Retry Neo4j synchronization
                </button>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="applications-heading" className={panelClass}>
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2
                className="text-lg font-semibold text-slate-950"
                id="applications-heading"
              >
                Applications and SBOMs
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Select an application and SBOM to inspect package versions,
                licenses, vulnerabilities, and graph relationships.
              </p>
            </div>
            <label className="min-w-64 text-sm font-medium text-slate-700">
              Application
              <select
                className={fieldClass}
                onChange={(event) => loadApplication(event.target.value)}
                value={selectedApplicationId}
              >
                <option value="">Select an application</option>
                {data?.applications.map((application) => (
                  <option key={application.id} value={application.id}>
                    {application.name} ({application.sbomCount} SBOMs)
                  </option>
                ))}
              </select>
            </label>
          </div>
          {applicationSboms && (
            <div className="mt-4">
              {applicationSboms.application ? (
                <>
                  <p className="text-sm font-semibold text-slate-800">
                    {applicationSboms.application.name}
                  </p>
                  {applicationSboms.application.description && (
                    <p className="mt-1 text-sm text-slate-600">
                      {applicationSboms.application.description}
                    </p>
                  )}
                  {applicationSboms.sboms.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">
                      No SBOMs have been imported for this application.
                    </p>
                  ) : (
                    <label className="mt-3 block max-w-xl text-sm font-medium text-slate-700">
                      SBOM
                      <select
                        className={fieldClass}
                        onChange={(event) => loadSbom(event.target.value)}
                        value={selectedSbomId}
                      >
                        <option value="">Select an SBOM</option>
                        {applicationSboms.sboms.map((sbom) => (
                          <option key={sbom.id} value={sbom.id}>
                            {sbom.format} · {sbom.componentCount} versions ·{" "}
                            {formatDate(sbom.generatedAt)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-600">
                  The selected application is no longer available.
                </p>
              )}
            </div>
          )}
        </section>

        {details && !details.sbom && (
          <p
            className={`${panelClass} text-sm text-slate-600`}
            role="status"
          >
            This SBOM is no longer available in MySQL.
          </p>
        )}
        {details?.sbom && (
          <>
            <section aria-labelledby="sbom-details-heading" className={panelClass}>
              <h2
                className="text-lg font-semibold text-slate-950"
                id="sbom-details-heading"
              >
                {details.sbom.applicationName} · {details.sbom.format}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Generated {formatDate(details.sbom.generatedAt)} ·{" "}
                {details.components.length} unique component versions
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2 pr-4">Component</th>
                      <th className="py-2 pr-4">Version</th>
                      <th className="py-2 pr-4">License(s)</th>
                      <th className="py-2">Vulnerabilities</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.components.map((component) => (
                      <tr
                        className="border-b border-slate-100"
                        key={component.id}
                      >
                        <td className="py-3 pr-4 font-medium">
                          {component.name}
                        </td>
                        <td className="py-3 pr-4">{component.version}</td>
                        <td className="py-3 pr-4">
                          {component.licenses.length
                            ? component.licenses.join(", ")
                            : "Not declared"}
                        </td>
                        <td className="py-3">
                          {component.vulnerabilities.length
                            ? component.vulnerabilities
                                .map(
                                  (finding) =>
                                    `${finding.cveId} (${finding.severity})`,
                                )
                                .join(", ")
                            : "None recorded"}
                        </td>
                      </tr>
                    ))}
                    {details.components.length === 0 && (
                      <tr>
                        <td
                          className="py-4 text-slate-500"
                          colSpan={4}
                        >
                          This SBOM has no component versions.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="graph-heading" className={panelClass}>
              <h2 className="text-lg font-semibold text-slate-950" id="graph-heading">
                Dependency graph
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Live graph relationships from Neo4j. Select a version node to
                run direct, transitive, reverse-impact, or shortest-path
                queries.
              </p>
              {details.graphError && (
                <p className="mt-3 text-sm text-amber-800" role="status">
                  {details.graphError}
                </p>
              )}
              <button
                className="mt-3 rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
                disabled={isPending}
                onClick={retryGraphSync}
                type="button"
              >
                Synchronize or retry Neo4j
              </button>
              <GraphVisualization
                details={details}
                onSelect={setSelectedVersionId}
              />
              {details.edges.length > 0 && (
                <ul className="mt-4 space-y-2 text-sm">
                  {details.edges.map((edge) => (
                    <li
                      className="rounded-md bg-slate-50 px-3 py-2"
                      key={`${edge.sourceId}:${edge.targetId}`}
                    >
                      <span className="font-medium">{edge.sourceName}</span>{" "}
                      <span className="text-emerald-800">depends on</span>{" "}
                      <span className="font-medium">{edge.targetName}</span>
                      {edge.scope && (
                        <span className="ml-2 text-xs text-slate-500">
                          ({edge.scope})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="analysis-heading" className={panelClass}>
              <h2
                className="text-lg font-semibold text-slate-950"
                id="analysis-heading"
              >
                Dependency and impact analysis
              </h2>
              <div className="mt-3 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                <label className="text-sm font-medium text-slate-700">
                  Component version
                  <select
                    className={fieldClass}
                    onChange={(event) => setSelectedVersionId(event.target.value)}
                    value={selectedVersionId}
                  >
                    {details.components.map((component) => (
                      <option key={component.id} value={component.id}>
                        {component.name} {component.version}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-slate-700">
                  Optional shortest-path target UUID
                  <input
                    className={fieldClass}
                    onChange={(event) => setTargetVersionId(event.target.value)}
                    placeholder="Target component-version UUID"
                    value={targetVersionId}
                  />
                </label>
                <button
                  className="self-end rounded-lg border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
                  disabled={isPending || !selectedVersionId}
                  onClick={analyzeVersion}
                  type="button"
                >
                  Analyze graph
                </button>
              </div>
              {analysis && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {analysis.ok ? (
                    <>
                      <AnalysisList
                        title="Direct dependencies"
                        items={analysis.direct.map(
                          (item) =>
                            `${item.componentVersion.version_number} · ${item.componentVersion.component_version_id.slice(0, 8)}`,
                        )}
                      />
                      <AnalysisList
                        title="Transitive dependencies"
                        items={analysis.transitive.map(
                          (item) =>
                            `Depth ${item.depth}: ${item.componentVersion.version_number}`,
                        )}
                      />
                      <AnalysisList
                        title="Reverse dependents"
                        items={analysis.dependents.map(
                          (item) =>
                            `Depth ${item.depth}: ${item.componentVersion.version_number}`,
                        )}
                      />
                      <AnalysisList
                        title="Affected applications"
                        items={analysis.affectedApplications.applications.map(
                          (item) =>
                            `${item.application.application_name} · depth ${item.dependencyDepth}`,
                        )}
                      />
                      {analysis.shortestPaths && (
                        <AnalysisList
                          title="Shortest paths"
                          items={analysis.shortestPaths.paths.map(
                            (path) => `${path.depth} dependency edges`,
                          )}
                        />
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-red-800" role="alert">
                      {analysis.error}
                    </p>
                  )}
                </div>
              )}
            </section>
          </>
        )}

        <section aria-labelledby="vulnerabilities-heading" className={panelClass}>
          <h2
            className="text-lg font-semibold text-slate-950"
            id="vulnerabilities-heading"
          >
            Vulnerability findings
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Findings and remediation state are sourced from MySQL.
          </p>
          {!data ? (
            <p className="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
              Vulnerability findings are unavailable until MySQL is connected.
            </p>
          ) : data.findings.length === 0 ? (
            <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              No vulnerability findings are currently recorded.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">CVE</th>
                    <th className="py-2 pr-4">Severity</th>
                    <th className="py-2 pr-4">Component</th>
                    <th className="py-2 pr-4">Application</th>
                    <th className="py-2">Remediation</th>
                  </tr>
                </thead>
                <tbody>
                  {data.findings.map((finding) => (
                    <tr className="border-b border-slate-100" key={finding.id}>
                      <td className="py-3 pr-4 font-medium">{finding.cveId}</td>
                      <td className="py-3 pr-4">{finding.severity}</td>
                      <td className="py-3 pr-4">
                        {finding.component} {finding.version}
                      </td>
                      <td className="py-3 pr-4">
                        {finding.application ?? "Unassigned"}
                      </td>
                      <td className="py-3">{finding.remediationStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function AnalysisList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {items.length ? (
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {items.map((item, index) => (
            <li key={`${item}:${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-500">None found.</p>
      )}
    </div>
  );
}
