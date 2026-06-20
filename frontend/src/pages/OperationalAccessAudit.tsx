import { useEffect, useMemo, useState } from "react";
import {
  exportAccessAudit,
  getAccessAuditEntries,
  getAccessAuditRoles,
  getAccessAuditSessions,
  getAccessAuditStats,
} from "../services/api";
import { useLocalStorageState } from "../hooks/useLocalStorageState";
import type {
  AccessAuditEntry,
  AccessAuditStats,
  AdminMember,
  AdminRotationEvent,
  AccessSession,
} from "../types";

type Tab = "changes" | "roles" | "sessions";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-300",
  warning: "bg-amber-500/15 text-amber-300",
  info: "bg-stellar-blue/15 text-stellar-blue",
};

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Login",
  "auth.logout": "Logout",
  "auth.api_key_created": "API Key Created",
  "auth.api_key_revoked": "API Key Revoked",
  "admin.config_changed": "Config Changed",
  "admin.provider_allowlist_changed": "Provider Allowlist Changed",
  "admin.user_permission_changed": "Permission Changed",
  "admin.retention_policy_changed": "Retention Policy Changed",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "bg-red-500/15 text-red-300",
  operator: "bg-amber-500/15 text-amber-300",
  auditor: "bg-stellar-blue/15 text-stellar-blue",
  viewer: "bg-emerald-500/15 text-emerald-300",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-stellar-border bg-stellar-card/80 px-5 py-4">
      <p className="text-xs uppercase tracking-[0.2em] text-stellar-text-secondary">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      {sub && <p className="mt-1 text-sm text-stellar-text-secondary">{sub}</p>}
    </div>
  );
}

export default function OperationalAccessAudit() {
  const [adminToken, setAdminToken] = useLocalStorageState(
    "bridge-watch:admin-api-key:v1",
    ""
  );
  const [activeTab, setActiveTab] = useState<Tab>("changes");

  // Entries state
  const [entries, setEntries] = useState<AccessAuditEntry[]>([]);
  const [entriesTotal, setEntriesTotal] = useState(0);
  const [flaggedActions, setFlaggedActions] = useState<string[]>([]);
  const [entriesOffset, setEntriesOffset] = useState(0);
  const ENTRIES_LIMIT = 50;

  // Roles state
  const [admins, setAdmins] = useState<AdminMember[]>([]);
  const [recentEvents, setRecentEvents] = useState<AdminRotationEvent[]>([]);
  const [showInactive, setShowInactive] = useState(false);

  // Sessions state
  const [sessions, setSessions] = useState<AccessSession[]>([]);
  const [sessionsMeta, setSessionsMeta] = useState({ total: 0, totalPages: 1, page: 1 });

  // Stats
  const [stats, setStats] = useState<AccessAuditStats | null>(null);

  // Filters
  const [filterActor, setFilterActor] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterFlagged, setFilterFlagged] = useState(false);
  const [filterSessionUser, setFilterSessionUser] = useState("");
  const [filterSessionStatus, setFilterSessionStatus] = useState<"" | "active" | "expired" | "revoked">("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!adminToken) return;
    setExporting(true);
    setError(null);
    try {
      await exportAccessAudit(adminToken, {
        actorId: filterActor || undefined,
        action: filterAction || undefined,
        severity: filterSeverity || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const flaggedCount = useMemo(
    () => entries.filter((e) => flaggedActions.includes(e.action) || e.severity !== "info").length,
    [entries, flaggedActions]
  );

  const activeSessionCount = useMemo(
    () => sessions.filter((s) => s.status === "active").length,
    [sessions]
  );

  const loadAll = async () => {
    if (!adminToken) return;
    setLoading(true);
    setError(null);
    try {
      const [statsData] = await Promise.all([getAccessAuditStats(adminToken)]);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  };

  const loadEntries = async (offset = 0) => {
    if (!adminToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAccessAuditEntries(adminToken, {
        actorId: filterActor || undefined,
        action: filterAction || undefined,
        severity: filterSeverity || undefined,
        flagged: filterFlagged,
        limit: ENTRIES_LIMIT,
        offset,
      });
      setEntries(result.entries);
      setEntriesTotal(result.total);
      setFlaggedActions(result.flaggedActions);
      setEntriesOffset(offset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load entries");
    } finally {
      setLoading(false);
    }
  };

  const loadRoles = async () => {
    if (!adminToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAccessAuditRoles(adminToken, !showInactive);
      setAdmins(result.admins);
      setRecentEvents(result.recentEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async (page = 1) => {
    if (!adminToken) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAccessAuditSessions(adminToken, {
        userId: filterSessionUser || undefined,
        status: filterSessionStatus || undefined,
        page,
        limit: 50,
      });
      setSessions(result.data);
      setSessionsMeta(result.meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [adminToken]);

  useEffect(() => {
    if (activeTab === "changes") void loadEntries(0);
    if (activeTab === "roles") void loadRoles();
    if (activeTab === "sessions") void loadSessions(1);
  }, [activeTab, adminToken]);

  useEffect(() => {
    if (activeTab === "roles") void loadRoles();
  }, [showInactive]);

  const handleApplyFilters = () => {
    if (activeTab === "changes") void loadEntries(0);
    if (activeTab === "sessions") void loadSessions(1);
  };

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-stellar-blue">Admin</p>
          <h1 className="mt-2 text-3xl font-bold text-white">
            Operational Access Audit Console
          </h1>
          <p className="mt-2 max-w-2xl text-stellar-text-secondary">
            Review operator roles, recent permission changes, active sessions, and
            flagged privilege escalations in one place.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {stats && (
            <>
              <StatCard
                label="Total access events"
                value={stats.total}
                sub={`${stats.recentCount} in last 24 h`}
              />
              <StatCard label="Active admins" value={stats.activeAdminCount} />
            </>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Admin token input                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-3xl border border-stellar-border bg-stellar-card/80 p-6">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white">
            Admin or bootstrap token
          </span>
          <input
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="Paste your admin API key"
            className="w-full max-w-lg rounded-2xl border border-stellar-border bg-stellar-dark px-4 py-3 text-white outline-none transition focus:border-stellar-blue focus:ring-2 focus:ring-stellar-blue"
          />
        </label>
        {!adminToken && (
          <p className="mt-2 text-sm text-stellar-text-secondary">
            Enter an admin API key to load audit data.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Tabs                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex gap-1 rounded-2xl border border-stellar-border bg-stellar-card/50 p-1 w-fit">
        {(
          [
            { id: "changes", label: "Access Changes" },
            { id: "roles", label: "Roles & Permissions" },
            { id: "sessions", label: "Sessions" },
          ] as { id: Tab; label: string }[]
        ).map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`rounded-xl px-5 py-2 text-sm font-medium transition ${
              activeTab === id
                ? "bg-stellar-blue text-white"
                : "text-stellar-text-secondary hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* ================================================================== */}
      {/* TAB: Access Changes                                                  */}
      {/* ================================================================== */}
      {activeTab === "changes" && (
        <section className="space-y-5">
          {/* Filters */}
          <div className="rounded-3xl border border-stellar-border bg-stellar-card/80 p-5">
            <h2 className="mb-4 text-base font-semibold text-white">Filters</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-xs text-stellar-text-secondary">Actor ID</span>
                <input
                  type="text"
                  value={filterActor}
                  onChange={(e) => setFilterActor(e.target.value)}
                  placeholder="actor-id or address"
                  className="w-full rounded-xl border border-stellar-border bg-stellar-dark px-3 py-2 text-sm text-white outline-none focus:border-stellar-blue"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-stellar-text-secondary">Action</span>
                <select
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                  className="w-full rounded-xl border border-stellar-border bg-stellar-dark px-3 py-2 text-sm text-white outline-none focus:border-stellar-blue"
                >
                  <option value="">All actions</option>
                  {Object.entries(ACTION_LABELS).map(([val, lbl]) => (
                    <option key={val} value={val}>{lbl}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-stellar-text-secondary">Severity</span>
                <select
                  value={filterSeverity}
                  onChange={(e) => setFilterSeverity(e.target.value)}
                  className="w-full rounded-xl border border-stellar-border bg-stellar-dark px-3 py-2 text-sm text-white outline-none focus:border-stellar-blue"
                >
                  <option value="">All severities</option>
                  <option value="critical">Critical</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
              </label>

              <div className="flex flex-col justify-end gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filterFlagged}
                    onChange={(e) => setFilterFlagged(e.target.checked)}
                    className="h-4 w-4 rounded border-stellar-border accent-stellar-blue"
                  />
                  <span className="text-sm text-stellar-text-secondary">Flagged only</span>
                </label>
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  className="rounded-xl bg-stellar-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  Apply
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <p className="text-sm text-stellar-text-secondary">
                {loading ? "Loading…" : `${entriesTotal} entries`}
                {filterFlagged && ` · ${flaggedCount} flagged`}
              </p>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={!adminToken || exporting}
                className="rounded-full border border-stellar-border px-4 py-1.5 text-xs text-stellar-text-secondary transition hover:border-stellar-blue hover:text-white disabled:opacity-40"
              >
                {exporting ? "Exporting…" : "Export CSV"}
              </button>
            </div>
          </div>

          {/* Entries list */}
          <div className="rounded-3xl border border-stellar-border bg-stellar-card/80 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Audit entries</h2>
              <button
                type="button"
                onClick={() => void loadEntries(entriesOffset)}
                className="rounded-full border border-stellar-border px-4 py-1.5 text-sm text-stellar-text-secondary transition hover:border-stellar-blue hover:text-white"
              >
                Refresh
              </button>
            </div>

            {entries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stellar-border px-4 py-10 text-center text-sm text-stellar-text-secondary">
                {adminToken ? "No access events found for the selected filters." : "Add an admin token above to load audit data."}
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => {
                  const isFlagged =
                    flaggedActions.includes(entry.action) || entry.severity !== "info";
                  return (
                    <article
                      key={entry.id}
                      className={`rounded-2xl border p-4 ${
                        isFlagged
                          ? "border-amber-500/40 bg-amber-500/5"
                          : "border-stellar-border bg-stellar-dark/70"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs uppercase tracking-[0.15em] ${
                              SEVERITY_COLORS[entry.severity] ?? "bg-stellar-border text-white"
                            }`}
                          >
                            {entry.severity}
                          </span>
                          <span className="text-sm font-medium text-white">
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </span>
                          {isFlagged && (
                            <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs text-amber-300">
                              Flagged
                            </span>
                          )}
                        </div>
                        <time className="text-xs text-stellar-text-secondary">
                          {formatDate(entry.createdAt)}
                        </time>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-stellar-text-secondary">
                        <span>
                          Actor:{" "}
                          <span className="text-white">{entry.actorId}</span>
                          {" "}
                          <span className="opacity-60">({entry.actorType})</span>
                        </span>
                        {entry.resourceType && (
                          <span>
                            Resource:{" "}
                            <span className="text-white">
                              {entry.resourceType}
                              {entry.resourceId ? ` / ${entry.resourceId}` : ""}
                            </span>
                          </span>
                        )}
                        {entry.ipAddress && (
                          <span>
                            IP: <span className="text-white">{entry.ipAddress}</span>
                          </span>
                        )}
                      </div>

                      {(entry.before || entry.after) && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs text-stellar-blue hover:underline">
                            View change diff
                          </summary>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {entry.before && (
                              <div className="rounded-xl border border-stellar-border bg-stellar-dark/80 p-3">
                                <p className="mb-1 text-xs uppercase text-stellar-text-secondary">
                                  Before
                                </p>
                                <pre className="overflow-x-auto text-xs text-white">
                                  {JSON.stringify(entry.before, null, 2)}
                                </pre>
                              </div>
                            )}
                            {entry.after && (
                              <div className="rounded-xl border border-stellar-border bg-stellar-dark/80 p-3">
                                <p className="mb-1 text-xs uppercase text-stellar-text-secondary">
                                  After
                                </p>
                                <pre className="overflow-x-auto text-xs text-white">
                                  {JSON.stringify(entry.after, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {entriesTotal > ENTRIES_LIMIT && (
              <div className="mt-5 flex items-center justify-between text-sm text-stellar-text-secondary">
                <span>
                  Showing {entriesOffset + 1}–
                  {Math.min(entriesOffset + ENTRIES_LIMIT, entriesTotal)} of {entriesTotal}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={entriesOffset === 0}
                    onClick={() => void loadEntries(Math.max(0, entriesOffset - ENTRIES_LIMIT))}
                    className="rounded-full border border-stellar-border px-4 py-1.5 transition hover:border-stellar-blue hover:text-white disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={entriesOffset + ENTRIES_LIMIT >= entriesTotal}
                    onClick={() => void loadEntries(entriesOffset + ENTRIES_LIMIT)}
                    className="rounded-full border border-stellar-border px-4 py-1.5 transition hover:border-stellar-blue hover:text-white disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================================================================== */}
      {/* TAB: Roles & Permissions                                             */}
      {/* ================================================================== */}
      {activeTab === "roles" && (
        <section className="space-y-5">
          <div className="rounded-3xl border border-stellar-border bg-stellar-card/80 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <h2 className="text-base font-semibold text-white">Admin members</h2>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-stellar-text-secondary">
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={(e) => setShowInactive(e.target.checked)}
                    className="h-4 w-4 rounded border-stellar-border accent-stellar-blue"
                  />
                  Show inactive
                </label>
                <button
                  type="button"
                  onClick={() => void loadRoles()}
                  className="rounded-full border border-stellar-border px-4 py-1.5 text-sm text-stellar-text-secondary transition hover:border-stellar-blue hover:text-white"
                >
                  Refresh
                </button>
              </div>
            </div>

            {admins.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stellar-border px-4 py-10 text-center text-sm text-stellar-text-secondary">
                {adminToken ? "No admin members found." : "Add an admin token above to load role data."}
              </div>
            ) : (
              <div className="space-y-3">
                {admins.map((admin) => (
                  <article
                    key={admin.id}
                    className="rounded-2xl border border-stellar-border bg-stellar-dark/70 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-medium text-white">{admin.name}</h3>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs uppercase tracking-[0.15em] ${
                              admin.isActive
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-red-500/15 text-red-300"
                            }`}
                          >
                            {admin.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-stellar-text-secondary font-mono">
                          {admin.address}
                        </p>
                        {admin.email && (
                          <p className="mt-0.5 text-xs text-stellar-text-secondary">
                            {admin.email}
                          </p>
                        )}
                      </div>
                      <p className="text-xs text-stellar-text-secondary">
                        Added: {formatDate(admin.createdAt)}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {admin.roles.map((role) => (
                        <span
                          key={role}
                          className={`rounded-full px-3 py-0.5 text-xs uppercase tracking-[0.15em] ${
                            ROLE_COLORS[role] ?? "bg-stellar-border text-white"
                          }`}
                        >
                          {role.replace("_", " ")}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-stellar-text-secondary">
                      Added by: <span className="text-white">{admin.addedBy}</span>
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          {/* Recent permission change events */}
          {recentEvents.length > 0 && (
            <div className="rounded-3xl border border-stellar-border bg-stellar-card/80 p-5">
              <h2 className="mb-4 text-base font-semibold text-white">
                Recent permission changes
              </h2>
              <div className="space-y-3">
                {recentEvents.map((ev) => (
                  <article
                    key={ev.id}
                    className={`rounded-2xl border p-4 ${
                      ev.eventType === "role_changed" || ev.eventType === "removed"
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-stellar-border bg-stellar-dark/70"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs uppercase tracking-[0.15em] ${
                            ev.eventType === "role_changed" || ev.eventType === "removed"
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-stellar-blue/15 text-stellar-blue"
                          }`}
                        >
                          {ev.eventType.replace("_", " ")}
                        </span>
                        <span className="text-sm text-white font-mono">{ev.adminAddress}</span>
                      </div>
                      <time className="text-xs text-stellar-text-secondary">
                        {formatDate(ev.createdAt)}
                      </time>
                    </div>
                    <p className="mt-1.5 text-xs text-stellar-text-secondary">
                      Actor: <span className="text-white">{ev.actorAddress}</span>
                      {ev.reason && (
                        <> · Reason: <span className="text-white">{ev.reason}</span></>
                      )}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ================================================================== */}
      {/* TAB: Sessions                                                        */}
      {/* ================================================================== */}
      {activeTab === "sessions" && (
        <section className="space-y-5">
          {/* Session filters */}
          <div className="rounded-3xl border border-stellar-border bg-stellar-card/80 p-5">
            <h2 className="mb-4 text-base font-semibold text-white">Filters</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs text-stellar-text-secondary">User ID</span>
                <input
                  type="text"
                  value={filterSessionUser}
                  onChange={(e) => setFilterSessionUser(e.target.value)}
                  placeholder="user-id"
                  className="w-full rounded-xl border border-stellar-border bg-stellar-dark px-3 py-2 text-sm text-white outline-none focus:border-stellar-blue"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-stellar-text-secondary">Status</span>
                <select
                  value={filterSessionStatus}
                  onChange={(e) =>
                    setFilterSessionStatus(
                      e.target.value as "" | "active" | "expired" | "revoked"
                    )
                  }
                  className="w-full rounded-xl border border-stellar-border bg-stellar-dark px-3 py-2 text-sm text-white outline-none focus:border-stellar-blue"
                >
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="expired">Expired</option>
                  <option value="revoked">Revoked</option>
                </select>
              </label>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  className="w-full rounded-xl bg-stellar-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  Apply
                </button>
              </div>
            </div>
            <p className="mt-3 text-sm text-stellar-text-secondary">
              {loading
                ? "Loading…"
                : `${sessionsMeta.total} sessions · ${activeSessionCount} active`}
            </p>
          </div>

          {/* Sessions list */}
          <div className="rounded-3xl border border-stellar-border bg-stellar-card/80 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Sessions</h2>
              <button
                type="button"
                onClick={() => void loadSessions(sessionsMeta.page)}
                className="rounded-full border border-stellar-border px-4 py-1.5 text-sm text-stellar-text-secondary transition hover:border-stellar-blue hover:text-white"
              >
                Refresh
              </button>
            </div>

            {sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stellar-border px-4 py-10 text-center text-sm text-stellar-text-secondary">
                {adminToken ? "No sessions found." : "Add an admin token above to load session data."}
              </div>
            ) : (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <article
                    key={session.id}
                    className="rounded-2xl border border-stellar-border bg-stellar-dark/70 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs uppercase tracking-[0.15em] ${
                              session.status === "active"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : session.status === "revoked"
                                ? "bg-red-500/15 text-red-300"
                                : "bg-stellar-border/30 text-stellar-text-secondary"
                            }`}
                          >
                            {session.status}
                          </span>
                          <span className="text-sm font-medium text-white">
                            {session.userId}
                          </span>
                        </div>
                        {session.deviceName && (
                          <p className="mt-1 text-xs text-stellar-text-secondary">
                            Device: {session.deviceName}
                            {session.deviceType ? ` (${session.deviceType})` : ""}
                          </p>
                        )}
                        {session.ipAddress && (
                          <p className="mt-0.5 text-xs text-stellar-text-secondary">
                            IP: <span className="text-white">{session.ipAddress}</span>
                          </p>
                        )}
                      </div>
                      <div className="text-right text-xs text-stellar-text-secondary space-y-0.5">
                        <p>Created: {formatDate(session.createdAt)}</p>
                        {session.lastActiveAt && (
                          <p>Last active: {formatDate(session.lastActiveAt)}</p>
                        )}
                        {session.expiresAt && (
                          <p>Expires: {formatDate(session.expiresAt)}</p>
                        )}
                        {session.revokedAt && (
                          <p className="text-red-300">
                            Revoked: {formatDate(session.revokedAt)}
                            {session.revokedReason ? ` · ${session.revokedReason}` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {/* Pagination */}
            {sessionsMeta.totalPages > 1 && (
              <div className="mt-5 flex items-center justify-between text-sm text-stellar-text-secondary">
                <span>
                  Page {sessionsMeta.page} of {sessionsMeta.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={sessionsMeta.page <= 1}
                    onClick={() => void loadSessions(sessionsMeta.page - 1)}
                    className="rounded-full border border-stellar-border px-4 py-1.5 transition hover:border-stellar-blue hover:text-white disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={sessionsMeta.page >= sessionsMeta.totalPages}
                    onClick={() => void loadSessions(sessionsMeta.page + 1)}
                    className="rounded-full border border-stellar-border px-4 py-1.5 transition hover:border-stellar-blue hover:text-white disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
