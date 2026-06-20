import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  auditService,
  type AuditAction,
  type AuditSeverity,
} from "../../services/audit.service.js";
import { AdminRotationService } from "../../services/adminRotation.service.js";
import { SessionService, type SessionStatus } from "../../services/session.service.js";
import { authMiddleware } from "../middleware/auth.js";

const ACCESS_AUDIT_ACTIONS: AuditAction[] = [
  "auth.login",
  "auth.logout",
  "auth.api_key_created",
  "auth.api_key_revoked",
  "admin.config_changed",
  "admin.provider_allowlist_changed",
  "admin.user_permission_changed",
  "admin.retention_policy_changed",
];

// Privilege escalations / sensitive changes that get flagged for review
const FLAGGED_ACTIONS: AuditAction[] = [
  "admin.user_permission_changed",
  "admin.config_changed",
  "admin.retention_policy_changed",
  "auth.api_key_revoked",
];

interface EntriesQuerystring {
  actorId?: string;
  action?: AuditAction;
  severity?: AuditSeverity;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  flagged?: string;
}

interface RolesQuerystring {
  activeOnly?: string;
}

interface SessionsQuerystring {
  userId?: string;
  status?: SessionStatus;
  page?: number;
  limit?: number;
}

export async function operationalAccessAuditRoutes(server: FastifyInstance) {
  const requireAuditRead = authMiddleware({ requiredScopes: ["admin:audit"] });
  const requireAuditAdmin = authMiddleware({
    requiredScopes: ["admin:audit", "admin:config"],
  });
  const adminRotationService = AdminRotationService.getInstance();
  const sessionService = new SessionService();

  // ---------------------------------------------------------------------------
  // GET /entries — paginated, filterable access audit log
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: EntriesQuerystring }>(
    "/entries",
    {
      preHandler: requireAuditRead,
      rateLimit: { max: 30, timeWindow: "1 minute" },
      schema: {
        tags: ["Admin"],
        summary: "List access audit log entries",
        security: [{ ApiKeyAuth: [] }],
      },
    } as any,
    async (
      request: FastifyRequest<{ Querystring: EntriesQuerystring }>,
      reply: FastifyReply
    ) => {
      try {
        const { actorId, severity, from, to, flagged } = request.query;
        const limit = Math.min(request.query.limit ? Number(request.query.limit) : 100, 500);
        const offset = request.query.offset ? Number(request.query.offset) : 0;

        // Validate requested action is an access-type action
        const action =
          request.query.action && ACCESS_AUDIT_ACTIONS.includes(request.query.action)
            ? request.query.action
            : undefined;

        const { entries, total } = await auditService.query({
          actorId,
          action,
          severity,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
          limit: limit + offset + 500, // fetch extra so post-filter still has enough
          offset: 0,
        });

        const accessEntries = entries.filter((e) => ACCESS_AUDIT_ACTIONS.includes(e.action));

        const flaggedOnly = flagged === "true";
        const filtered = flaggedOnly
          ? accessEntries.filter(
              (e) =>
                FLAGGED_ACTIONS.includes(e.action) ||
                e.severity === "critical" ||
                e.severity === "warning"
            )
          : accessEntries;

        const page = filtered.slice(offset, offset + limit);

        return {
          entries: page,
          total: filtered.length,
          limit,
          offset,
          flaggedActions: FLAGGED_ACTIONS,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to query access audit log";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // GET /stats — aggregate stats for the access audit console
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: { from?: string } }>(
    "/stats",
    {
      preHandler: requireAuditRead,
      rateLimit: { max: 30, timeWindow: "1 minute" },
      schema: {
        tags: ["Admin"],
        summary: "Access audit aggregate statistics",
        security: [{ ApiKeyAuth: [] }],
      },
    } as any,
    async (
      request: FastifyRequest<{ Querystring: { from?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const from = request.query.from ? new Date(request.query.from) : undefined;
        const [stats, adminCount] = await Promise.all([
          auditService.getStats(from),
          adminRotationService.getActiveAdminCount(),
        ]);

        return {
          ...stats,
          activeAdminCount: adminCount,
          trackedActions: ACCESS_AUDIT_ACTIONS,
          flaggedActions: FLAGGED_ACTIONS,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get access audit stats";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // GET /roles — admin members, their roles, and recent rotation events
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: RolesQuerystring }>(
    "/roles",
    {
      preHandler: requireAuditRead,
      rateLimit: { max: 30, timeWindow: "1 minute" },
      schema: {
        tags: ["Admin"],
        summary: "List admin roles, memberships, and recent permission changes",
        security: [{ ApiKeyAuth: [] }],
      },
    } as any,
    async (
      request: FastifyRequest<{ Querystring: RolesQuerystring }>,
      reply: FastifyReply
    ) => {
      try {
        const activeOnly = request.query.activeOnly !== "false";
        const [admins, recentEvents] = await Promise.all([
          adminRotationService.listAdmins(activeOnly),
          adminRotationService.getRotationEvents(undefined, 50),
        ]);

        return { admins, recentEvents };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to list admin roles";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // GET /sessions — list user sessions with optional filters
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: SessionsQuerystring }>(
    "/sessions",
    {
      preHandler: requireAuditRead,
      rateLimit: { max: 30, timeWindow: "1 minute" },
      schema: {
        tags: ["Admin"],
        summary: "List user sessions for access review",
        security: [{ ApiKeyAuth: [] }],
      },
    } as any,
    async (
      request: FastifyRequest<{ Querystring: SessionsQuerystring }>,
      reply: FastifyReply
    ) => {
      try {
        const { userId, status } = request.query;
        const page = request.query.page ? Number(request.query.page) : 1;
        const limit = Math.min(
          request.query.limit ? Number(request.query.limit) : 50,
          200
        );

        const result = await sessionService.listSessions({
          userId,
          status: status as SessionStatus | undefined,
          page,
          limit,
        });

        return { success: true, data: result.data, meta: result.meta };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to list sessions";
        return reply.code(500).send({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // GET /export — CSV export of access audit entries
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: EntriesQuerystring }>(
    "/export",
    {
      preHandler: requireAuditAdmin,
      rateLimit: { max: 5, timeWindow: "1 minute" },
      schema: {
        tags: ["Admin"],
        summary: "Export access audit log as CSV",
        security: [{ ApiKeyAuth: [] }],
      },
    } as any,
    async (
      request: FastifyRequest<{ Querystring: EntriesQuerystring }>,
      reply: FastifyReply
    ) => {
      try {
        const { actorId, severity, from, to } = request.query;
        const action =
          request.query.action && ACCESS_AUDIT_ACTIONS.includes(request.query.action)
            ? request.query.action
            : undefined;

        const csv = await auditService.exportCsv({
          actorId,
          action,
          severity,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        });

        return reply
          .code(200)
          .header("Content-Type", "text/csv")
          .header(
            "Content-Disposition",
            `attachment; filename="access-audit-${Date.now()}.csv"`
          )
          .send(csv);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to export access audit log";
        return reply.code(500).send({ error: message });
      }
    }
  );
}
