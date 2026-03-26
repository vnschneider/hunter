/**
 * Application Tracking Engine (Phase 5)
 * Rastreia aplicações, status, seguimentos e auditoria
 */

const STATUS = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  PENDING: "pending",
  INTERVIEW: "interview",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
  ACCEPTED: "accepted",
};

const STATUS_TRANSITIONS = {
  draft: ["submitted", "withdrawn"],
  submitted: ["pending", "withdrawn"],
  pending: ["interview", "rejected", "withdrawn"],
  interview: ["accepted", "rejected", "withdrawn"],
  rejected: ["withdrawn"],
  withdrawn: [],
  accepted: [],
};

export function createApplicationTrackingEngine(options = {}, logger = null) {
  const log =
    logger?.log ||
    ((level, msg, ctx) => console.log(`[${level}] ${msg}`, ctx || ""));

  // In-memory cache: Map<userId, Map<appId, app>>
  const applicationsCache = new Map();
  let statsCache = {
    totalApplications: 0,
    submittedCount: 0,
    pendingCount: 0,
    interviewCount: 0,
    rejectedCount: 0,
    acceptedCount: 0,
    withdrawnCount: 0,
    auditLogSize: 0,
    lastHunt: null,
  };

  const auditLog = [];
  const MAX_AUDIT_SIZE = options.maxAuditLogSize || 10000;

  /**
   * Rastreia aplicação inteira (draft → submitted → pending → decision)
   */
  function createApplication(
    draftId,
    userId,
    opening,
    submittedFields,
    submittedBy = "user",
  ) {
    const appId = `app-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    const application = {
      id: appId,
      draftId,
      userId,
      openingId: opening.id || opening.externalId,
      openingTitle: opening.title,
      openingUrl: opening.url,
      openingSource: opening.platform || opening.source,
      submittedFields: submittedFields || {},
      submittedAt: now,
      submittedBy: submittedBy, // 'user' | 'tier2' | 'tier3' (auto)
      status: STATUS.SUBMITTED,
      statusHistory: [
        {
          status: STATUS.SUBMITTED,
          timestamp: now,
          changedBy: submittedBy,
          reason: "Aplicação enviada",
        },
      ],
      notes: [],
      lastStatusUpdate: now,
      createdAt: now,
      updatedAt: now,
      followupAt: null, // 7 dias depois (auto)
      flags: {
        hasInterview: false,
        hasRejection: false,
        isFollowupPending: true,
      },
    };

    // Agendamento automático de seguimento (7 dias)
    if (submittedBy !== "user") {
      // Auto-submitted (tier2/3) → espera resposta
      const followupDate = new Date(now);
      followupDate.setDate(followupDate.getDate() + 7);
      application.followupAt = followupDate.toISOString();
    }

    // Cache
    if (!applicationsCache.has(userId)) {
      applicationsCache.set(userId, new Map());
    }
    applicationsCache.get(userId).set(appId, application);

    // Stats
    statsCache.totalApplications++;
    statsCache.submittedCount++;
    statsCache.lastHunt = now;

    // Audit
    recordAudit("application_created", userId, {
      applicationId: appId,
      draftId,
      openingTitle: opening.title,
      submittedBy,
      fieldsCount: Object.keys(submittedFields || {}).length,
    });

    log("debug", "application_created", {
      appId,
      openingTitle: opening.title,
      submittedBy,
    });

    return application;
  }

  /**
   * Atualiza status da aplicação
   */
  function updateApplicationStatus(
    applicationId,
    newStatus,
    userId,
    reason = "",
  ) {
    const userApps = applicationsCache.get(userId);
    if (!userApps) {
      log("warn", "user_not_found_in_cache", { userId });
      return null;
    }

    const app = userApps.get(applicationId);
    if (!app) {
      log("warn", "application_not_found", { applicationId });
      return null;
    }

    const currentStatus = app.status;

    // Validar transição
    if (!STATUS_TRANSITIONS[currentStatus].includes(newStatus)) {
      log("warn", "invalid_status_transition", {
        from: currentStatus,
        to: newStatus,
      });
      return null;
    }

    const now = new Date().toISOString();
    app.status = newStatus;
    app.lastStatusUpdate = now;
    app.updatedAt = now;

    // Status history
    app.statusHistory.push({
      status: newStatus,
      timestamp: now,
      changedBy: "system",
      reason,
    });

    // Update stats
    updateStatsForStatusChange(currentStatus, newStatus);

    // Flags
    if (newStatus === STATUS.INTERVIEW) app.flags.hasInterview = true;
    if (newStatus === STATUS.REJECTED) app.flags.hasRejection = true;
    if ([STATUS.INTERVIEW, STATUS.ACCEPTED].includes(newStatus)) {
      app.flags.isFollowupPending = false;
    }

    // Audit
    recordAudit("status_updated", userId, {
      applicationId,
      from: currentStatus,
      to: newStatus,
      reason,
    });

    log("debug", "application_status_updated", {
      appId: applicationId,
      newStatus,
      reason,
    });

    return app;
  }

  /**
   * Adiciona nota à aplicação
   */
  function addApplicationNote(
    applicationId,
    userId,
    note,
    noteType = "manual",
  ) {
    const userApps = applicationsCache.get(userId);
    if (!userApps) return null;

    const app = userApps.get(applicationId);
    if (!app) return null;

    const noteEntry = {
      timestamp: new Date().toISOString(),
      type: noteType, // 'manual' | 'system' | 'interview_alert'
      content: note,
      addedBy: "user",
    };

    app.notes.push(noteEntry);
    app.updatedAt = new Date().toISOString();

    recordAudit("note_added", userId, {
      applicationId,
      noteType,
      contentPreview: note.slice(0, 100),
    });

    return app;
  }

  /**
   * Retira aplicação (soft delete com razão)
   */
  function withdrawApplication(
    applicationId,
    userId,
    reason = "Retirada pelo usuário",
  ) {
    const app = updateApplicationStatus(
      applicationId,
      STATUS.WITHDRAWN,
      userId,
      reason,
    );

    if (app) {
      app.flags.isFollowupPending = false;
      recordAudit("application_withdrawn", userId, {
        applicationId,
        reason,
      });
    }

    return app;
  }

  /**
   * Busca aplicações com filtros
   */
  function getApplications(userId, filters = {}) {
    const userApps = applicationsCache.get(userId);
    if (!userApps) return [];

    let apps = Array.from(userApps.values());

    // Filtros
    if (filters.status) {
      apps = apps.filter((a) => a.status === filters.status);
    }
    if (filters.source) {
      apps = apps.filter((a) => a.openingSource === filters.source);
    }
    if (filters.submittedBy) {
      apps = apps.filter((a) => a.submittedBy === filters.submittedBy);
    }
    if (filters.fromDate) {
      apps = apps.filter(
        (a) => new Date(a.submittedAt) >= new Date(filters.fromDate),
      );
    }
    if (filters.toDate) {
      apps = apps.filter(
        (a) => new Date(a.submittedAt) <= new Date(filters.toDate),
      );
    }

    // Sort padrão: mais recentes primeiro
    return apps.sort(
      (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt),
    );
  }

  /**
   * Aplicações pendentes de seguimento (7+ dias)
   */
  function getFollowupReminders(userId) {
    const userApps = applicationsCache.get(userId);
    if (!userApps) return [];

    const now = new Date();
    const reminders = Array.from(userApps.values()).filter((app) => {
      if (!app.flags.isFollowupPending) return false;
      if (!app.followupAt) return false;

      const followupDate = new Date(app.followupAt);
      return now >= followupDate;
    });

    return reminders.sort(
      (a, b) => new Date(a.followupAt) - new Date(b.followupAt),
    );
  }

  /**
   * Conta aplicações por status / período
   */
  function getMetrics(userId) {
    const userApps = applicationsCache.get(userId);
    if (!userApps) {
      return {
        total: 0,
        byStatus: {},
        bySource: {},
        bySubmitter: {},
        thisWeek: 0,
      };
    }

    const apps = Array.from(userApps.values());
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const byStatus = {};
    const bySource = {};
    const bySubmitter = {};

    apps.forEach((app) => {
      // By status
      byStatus[app.status] = (byStatus[app.status] || 0) + 1;

      // By source
      bySource[app.openingSource] = (bySource[app.openingSource] || 0) + 1;

      // By submitter
      bySubmitter[app.submittedBy] = (bySubmitter[app.submittedBy] || 0) + 1;
    });

    const thisWeek = apps.filter(
      (a) => new Date(a.submittedAt) >= oneWeekAgo,
    ).length;

    return {
      total: apps.length,
      byStatus,
      bySource,
      bySubmitter,
      thisWeek,
      averageSubmissionsPerDay: (apps.length / 30).toFixed(2),
    };
  }

  /**
   * Recupera aplicação por ID
   */
  function getApplication(applicationId, userId) {
    const userApps = applicationsCache.get(userId);
    if (!userApps) return null;
    return userApps.get(applicationId) || null;
  }

  /**
   * Retorna estatísticas do engine
   */
  function getStats() {
    return {
      ...statsCache,
      cacheSize: applicationsCache.size,
    };
  }

  /**
   * Retorna audit log com filtros
   */
  function getAuditLog(filters = {}) {
    let log = [...auditLog];

    if (filters.userId) {
      log = log.filter((e) => e.userId === filters.userId);
    }
    if (filters.action) {
      log = log.filter((e) => e.action === filters.action);
    }
    if (filters.fromDate) {
      log = log.filter(
        (e) => new Date(e.timestamp) >= new Date(filters.fromDate),
      );
    }

    return log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Limpa cache (para testes)
   */
  function clearCache() {
    applicationsCache.clear();
    auditLog.length = 0;
    statsCache = {
      totalApplications: 0,
      submittedCount: 0,
      pendingCount: 0,
      interviewCount: 0,
      rejectedCount: 0,
      acceptedCount: 0,
      withdrawnCount: 0,
      auditLogSize: 0,
      lastHunt: null,
    };
  }

  // ============= PRIVATE =============

  function recordAudit(action, userId, details) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      userId,
      details,
    };

    auditLog.push(entry);
    statsCache.auditLogSize = auditLog.length;

    // Limpa audit log se muito grande
    if (auditLog.length > MAX_AUDIT_SIZE) {
      auditLog.splice(0, auditLog.length - MAX_AUDIT_SIZE);
      statsCache.auditLogSize = auditLog.length;
    }
  }

  function updateStatsForStatusChange(oldStatus, newStatus) {
    const statusMap = {
      draft: "submittedCount",
      submitted: "pendingCount", // simplified
      pending: newStatus === "interview" ? "interviewCount" : "rejectedCount",
      interview: newStatus === "accepted" ? "acceptedCount" : "rejectedCount",
      rejected: "rejectedCount",
      withdrawn: "withdrawnCount",
      accepted: "acceptedCount",
    };

    // Decrement old
    if (statusMap[oldStatus] && statsCache[statusMap[oldStatus]]) {
      statsCache[statusMap[oldStatus]]--;
    }

    // Increment new
    if (newStatus === "interview") statsCache.interviewCount++;
    if (newStatus === "rejected") statsCache.rejectedCount++;
    if (newStatus === "accepted") statsCache.acceptedCount++;
    if (newStatus === "withdrawn") statsCache.withdrawnCount++;
  }

  // ============= PUBLIC API =============

  return {
    createApplication,
    updateApplicationStatus,
    addApplicationNote,
    withdrawApplication,
    getApplications,
    getFollowupReminders,
    getMetrics,
    getApplication,
    getStats,
    getAuditLog,
    clearCache,
    STATUS,
    STATUS_TRANSITIONS,
  };
}
