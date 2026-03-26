/**
 * Application Engine - Fase D
 *
 * Motor de classificação e candidatura com:
 * - Classificação por confiança (auto_apply | review | keep)
 * - Geração de application drafts
 * - Política segura com 3 níveis de automação
 * - Trilha de auditoria completa
 *
 * Modelo: { openings + scores } → { applications + drafts + audit }
 */

/**
 * Define classe para candidatura baseada em score + estratégia
 */
function classifyOpening(opening, profile, strategy = {}) {
  const score = Number(opening.matchScore ?? 0);
  const autoApplyThreshold = strategy.autoApplyThreshold ?? 75;
  const reviewThreshold = strategy.reviewThreshold ?? 50;

  // Verifica se source é permitida para auto-apply
  const allowedSources = strategy.allowedAutoApplySources ?? [
    "linkedin",
    "nerdin",
  ];
  const sourceAllowed = allowedSources.includes(opening.source);

  // Verifica se há exclusões por keyword
  const excludedKeywords = strategy.excludedKeywords ?? [];
  const titleLower = (opening.title ?? "").toLowerCase();
  const descLower = (opening.description ?? "").toLowerCase();
  const hasExcluded = excludedKeywords.some(
    (kw) =>
      titleLower.includes(kw.toLowerCase()) ||
      descLower.includes(kw.toLowerCase()),
  );

  if (hasExcluded) {
    return {
      class: "keep_for_later",
      reason: "excluded_keywords",
      score,
    };
  }

  if (score >= autoApplyThreshold && sourceAllowed) {
    return {
      class: "auto_apply_candidate",
      reason: "high_confidence_allowed_source",
      score,
    };
  }

  if (score >= reviewThreshold) {
    return {
      class: "review_recommended",
      reason: "medium_confidence_or_new_source",
      score,
    };
  }

  return {
    class: "keep_for_later",
    reason: "low_confidence",
    score,
  };
}

/**
 * Gera draft de candidatura para uma vaga
 */
function generateApplicationDraft(opening, profile, classification, userId) {
  const now = new Date().toISOString();
  const draftId = `draft-${userId}-${opening.sourceId}-${Date.now()}`;

  return {
    draftId,
    userId,
    openingId: opening.sourceId,
    openingSource: opening.source,
    openingUrl: opening.applyUrl || opening.sourceUrl,
    jobTitle: opening.title,
    companyName: opening.companyName,
    classification: classification.class,
    confidenceScore: classification.score,
    classificationReason: classification.reason,
    // Fields to fill (platform-specific)
    fields: {
      fullName: profile.fullName ?? "",
      email: profile.email ?? "",
      phone: profile.phone ?? "",
      location: profile.currentLocation ?? "",
      linkedInUrl: profile.linkedInUrl ?? "",
      portfolioUrl: profile.portfolioUrl ?? "",
      coverLetter: "",
      experience: profile.resumeText ?? "",
    },
    // Metadata
    appliedAt: null, // Set when actually applied
    appliedVia: "auto_draft", // "auto_draft" | "manual" | "auto_applied"
    createdAt: now,
    updatedAt: now,
    status: "draft", // "draft" | "reviewing" | "submitted" | "rejected"
    auditTrail: [
      {
        action: "created",
        timestamp: now,
        actor: "system",
        details: `Created by Application Engine (${classification.class})`,
      },
    ],
  };
}

/**
 * Factory: cria application engine com classificação + drafts
 */
export function createApplicationEngine(config = {}, logger = console) {
  const draftCache = new Map(); // draftId -> draft object
  const auditLog = []; // Full audit trail

  // Stats
  let stats = {
    totalClassified: 0,
    autoApplyCandidates: 0,
    reviewRecommended: 0,
    keepForLater: 0,
    draftsCreated: 0,
    draftSubmitted: 0,
    auditLogSize: 0,
  };

  /**
   * Classifica múltiplas vagas de acordo com estratégia
   *
   * Parâmetros:
   *   openings: [] de openings com matchScore
   *   profile: perfil do utilizador (keywords, thresholds, etc)
   *   strategy: { autoApplyThreshold, reviewThreshold, allowedSources, excludedKeywords }
   *
   * Retorna: [{ opening, classification, draft? }]
   */
  function classifyMany(openings, profile, strategy = {}) {
    const results = [];
    const classifications = {
      auto_apply_candidate: [],
      review_recommended: [],
      keep_for_later: [],
    };

    for (const opening of openings) {
      const classification = classifyOpening(opening, profile, strategy);
      classifications[classification.class].push(opening);
      stats.totalClassified++;

      if (classification.class === "auto_apply_candidate") {
        stats.autoApplyCandidates++;
      } else if (classification.class === "review_recommended") {
        stats.reviewRecommended++;
      } else {
        stats.keepForLater++;
      }

      results.push({
        opening,
        classification,
      });
    }

    logger.log("info", "application-engine: classified openings", {
      total: openings.length,
      auto_apply: classifications.auto_apply_candidate.length,
      review: classifications.review_recommended.length,
      keep: classifications.keep_for_later.length,
    });

    return results;
  }

  /**
   * Gera drafts para vagas classificadas como review_recommended
   *
   * Parâmetros:
   *   classified: resultado de classifyMany()
   *   userId: ID do utilizador
   *
   * Retorna: [draft objects] armazenados em cache
   */
  function generateDraftsForReview(classified, userId, profile) {
    const drafts = [];

    for (const item of classified) {
      if (item.classification.class === "review_recommended") {
        const draft = generateApplicationDraft(
          item.opening,
          profile,
          item.classification,
          userId,
        );
        draftCache.set(draft.draftId, draft);
        drafts.push(draft);
        stats.draftsCreated++;

        // Log audit
        recordAudit("draft_created", userId, {
          draftId: draft.draftId,
          opening: item.opening.sourceId,
          classification: item.classification.class,
        });
      }
    }

    logger.log("info", "application-engine: generated drafts", {
      count: drafts.length,
      userId,
    });

    return drafts;
  }

  /**
   * Aprova um draft para candidatura automática (tier 1)
   * Apenas muda status para "reviewing", não submete ainda
   */
  function approveDraftForReview(draftId, userId, notes = "") {
    const draft = draftCache.get(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (draft.userId !== userId) {
      throw new Error(`Draft ${draftId} does not belong to user ${userId}`);
    }

    draft.status = "reviewing";
    draft.appliedVia = "user_approved";
    draft.updatedAt = new Date().toISOString();
    draft.auditTrail.push({
      action: "approved_for_review",
      timestamp: draft.updatedAt,
      actor: `user:${userId}`,
      details: notes,
    });

    recordAudit("draft_approved", userId, {
      draftId,
      notes,
    });

    return draft;
  }

  /**
   * Rejeita um draft (não candidatura)
   */
  function rejectDraft(draftId, userId, reason = "") {
    const draft = draftCache.get(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (draft.userId !== userId) {
      throw new Error(`Draft ${draftId} does not belong to user ${userId}`);
    }

    draft.status = "rejected";
    draft.updatedAt = new Date().toISOString();
    draft.auditTrail.push({
      action: "rejected",
      timestamp: draft.updatedAt,
      actor: `user:${userId}`,
      details: reason,
    });

    recordAudit("draft_rejected", userId, {
      draftId,
      reason,
    });

    return draft;
  }

  /**
   * Submete um draft de candidatura (user-approved ou auto)
   * Retorna application object pronto para persistência
   */
  function submitDraft(draftId, userId, overrideFields = {}) {
    const draft = draftCache.get(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }

    if (draft.userId !== userId) {
      throw new Error(`Draft ${draftId} does not belong to user ${userId}`);
    }

    const now = new Date().toISOString();

    // Merge override fields if provided
    const finalFields = { ...draft.fields, ...overrideFields };

    const application = {
      applicationId: `app-${userId}-${draft.openingId}-${Date.now()}`,
      draftId: draft.draftId,
      userId,
      openingId: draft.openingId,
      openingSource: draft.openingSource,
      jobTitle: draft.jobTitle,
      companyName: draft.companyName,
      confidenceScore: draft.confidenceScore,
      submittedFields: finalFields,
      submittedAt: now,
      status: "submitted",
      auditTrail: [
        {
          action: "submitted",
          timestamp: now,
          actor: `user:${userId}`,
          details: `Submitted with overrides: ${Object.keys(overrideFields).join(", ")}`,
        },
      ],
    };

    // Update draft
    draft.status = "submitted";
    draft.appliedAt = now;
    draft.appliedVia =
      overrideFields.length > 0 ? "user_edited" : "auto_approved";
    draft.updatedAt = now;
    draft.auditTrail.push({
      action: "submitted",
      timestamp: now,
      actor: `user:${userId}`,
      details: `Submitted from draft`,
    });

    stats.draftSubmitted++;
    recordAudit("application_submitted", userId, {
      applicationId: application.applicationId,
      draftId,
      fieldsChanged: Object.keys(overrideFields).length,
    });

    return application;
  }

  /**
   * Registra uma entrada na trilha de auditoria
   */
  function recordAudit(action, userId, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      userId,
      details,
    };

    auditLog.push(entry);
    stats.auditLogSize = auditLog.length;

    logger.log("debug", `audit: ${action}`, { userId, ...details });
  }

  /**
   * Retorna estatísticas
   */
  function getStats() {
    return {
      ...stats,
      draftsInCache: draftCache.size,
    };
  }

  /**
   * Retorna audit log completo (com filtro opcional)
   */
  function getAuditLog(filters = {}) {
    let results = auditLog;

    if (filters.userId) {
      results = results.filter((e) => e.userId === filters.userId);
    }

    if (filters.action) {
      results = results.filter((e) => e.action === filters.action);
    }

    if (filters.since) {
      const sinceTime = new Date(filters.since).getTime();
      results = results.filter(
        (e) => new Date(e.timestamp).getTime() >= sinceTime,
      );
    }

    return results;
  }

  /**
   * Retorna draft por ID
   */
  function getDraft(draftId) {
    return draftCache.get(draftId) ?? null;
  }

  /**
   * Retorna todos os drafts de um utilizador
   */
  function getUserDrafts(userId, status = null) {
    const results = Array.from(draftCache.values()).filter(
      (d) => d.userId === userId,
    );

    if (status) {
      return results.filter((d) => d.status === status);
    }

    return results;
  }

  /**
   * Limpa cache de drafts
   */
  function clearCache() {
    draftCache.clear();
  }

  return {
    classifyMany,
    generateDraftsForReview,
    approveDraftForReview,
    rejectDraft,
    submitDraft,
    getStats,
    getAuditLog,
    getDraft,
    getUserDrafts,
    clearCache,
  };
}
