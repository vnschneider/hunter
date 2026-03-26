/**
 * Application Submission Engine (Tier 2 - Auto-fill)
 * Orquestra envio de aplicações para diferentes plataformas (email, APIs, etc)
 */

export function createApplicationSubmissionEngine(options = {}, logger = null) {
  const log =
    logger?.log ||
    ((level, msg, ctx) => console.log(`[${level}] ${msg}`, ctx || ""));

  const submissionCache = new Map(); // Map<userId, Map<appId, submission>>
  let statsCache = {
    totalSubmissions: 0,
    emailSubmissions: 0,
    apiSubmissions: 0,
    formSubmissions: 0,
    successCount: 0,
    failureCount: 0,
    retryCount: 0,
    auditLogSize: 0,
  };

  const auditLog = [];
  const MAX_AUDIT_SIZE = options.maxAuditLogSize || 10000;

  /**
   * Prepara aplicação para envio (Tier 2: user revisa before sending)
   * Valida campos obrigatórios e formata conforme plataforma
   */
  function prepareForSubmission(application, editedFields = null) {
    const prepared = {
      ...application,
      submittedFields: {
        ...application.submittedFields,
        ...(editedFields || {}), // User pode ter editado
      },
      preparedAt: new Date().toISOString(),
      submissionRequirements: {
        hasResume: !!application.submittedFields?.resume,
        hasEmail: !!application.submittedFields?.email,
        hasCoverLetterOrMessage: !!(
          application.submittedFields?.coverLetter ||
          application.submittedFields?.message
        ),
      },
      isReadyForSubmission: true, // Default: user confirmed
    };

    // Validação básica
    if (!prepared.submissionRequirements.hasEmail) {
      prepared.isReadyForSubmission = false;
      prepared.submissionBlockers = ["Email obrigatório não preenchido"];
    }

    if (!prepared.submissionRequirements.hasResume) {
      prepared.isReadyForSubmission = false;
      (prepared.submissionBlockers = prepared.submissionBlockers || []).push(
        "Currículo obrigatório não preenchido",
      );
    }

    return prepared;
  }

  /**
   * Submete aplicação via email (usado quando plataforma não tem API)
   * Envia template pre-formatado para empresa ou sistema intermediário
   */
  async function submitViaEmail(
    application,
    targetEmail,
    userEmail,
    html = null,
  ) {
    const submissionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const submission = {
      id: submissionId,
      applicationId: application.id,
      method: "email",
      targetEmail,
      userEmail,
      submittedAt: new Date().toISOString(),
      status: "pending_send",
      retries: 0,
      lastAttempt: null,
      errors: [],
    };

    // Simula envio (em produção, usar nodemailer/SendGrid/SES)
    try {
      // Criar conteúdo do email
      const emailContent = html || generateEmailTemplate(application);

      // Simulação: em produção usar:
      // await emailService.send({
      //   to: targetEmail,
      //   from: userEmail,
      //   subject: `Candidatura: ${application.openingTitle}`,
      //   html: emailContent,
      //   attachments: [...files from application.submittedFields]
      // });

      log("debug", "email_submission_prepared", {
        submissionId,
        to: targetEmail,
        subject: `Candidatura: ${application.openingTitle}`,
      });

      submission.status = "email_prepared";
      submission.emailContent = emailContent;

      // Cache
      recordSubmission(application.userId, submissionId, submission);

      recordAudit("submission_via_email", application.userId, {
        applicationId: application.id,
        submissionId,
        targetEmail,
        from: userEmail,
      });

      statsCache.totalSubmissions++;
      statsCache.emailSubmissions++;

      return {
        success: true,
        submissionId,
        submission,
        message: `Email preparado para: ${targetEmail}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      submission.status = "email_failed";
      submission.errors.push({
        timestamp: new Date().toISOString(),
        message: msg,
      });

      recordAudit("submission_email_failed", application.userId, {
        applicationId: application.id,
        error: msg,
      });

      statsCache.totalSubmissions++;
      statsCache.failureCount++;

      log("error", "email_submission_failed", {
        applicationId: application.id,
        error: msg,
      });

      return {
        success: false,
        submissionId,
        submission,
        error: msg,
      };
    }
  }

  /**
   * Submete aplicação via API (LinkedIn, Greenhouse, etc)
   * Requer configuração de API credentials
   */
  async function submitViaAPI(application, apiConfig) {
    const submissionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const submission = {
      id: submissionId,
      applicationId: application.id,
      method: "api",
      platform: apiConfig.platform, // 'linkedin' | 'greenhouse' | 'lever'
      submittedAt: new Date().toISOString(),
      status: "pending_api",
      retries: 0,
      lastAttempt: null,
      errors: [],
      apiResponse: null,
    };

    try {
      // Validar credenciais
      if (!apiConfig.accessToken) {
        throw new Error("API access token ausente");
      }

      // Formatar payload conforme plataforma
      const payload = formatPayloadForPlatform(application, apiConfig.platform);

      // Simular chamada à API
      log("debug", "api_submission_prepared", {
        submissionId,
        platform: apiConfig.platform,
        openingId: application.openingId,
      });

      // Em produção:
      // const response = await fetch(apiConfig.endpoint, {
      //   method: 'POST',
      //   headers: {
      //     'Authorization': `Bearer ${apiConfig.accessToken}`,
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify(payload),
      // });

      submission.status = "api_submitted";
      submission.apiResponse = {
        platform: apiConfig.platform,
        payload: payload,
        timestamp: new Date().toISOString(),
      };

      // Cache
      recordSubmission(application.userId, submissionId, submission);

      recordAudit("submission_via_api", application.userId, {
        applicationId: application.id,
        submissionId,
        platform: apiConfig.platform,
      });

      statsCache.totalSubmissions++;
      statsCache.apiSubmissions++;
      statsCache.successCount++;

      return {
        success: true,
        submissionId,
        submission,
        message: `Aplicação enviada via ${apiConfig.platform}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      submission.status = "api_failed";
      submission.errors.push({
        timestamp: new Date().toISOString(),
        message: msg,
      });
      submission.retries++;

      recordAudit("submission_api_failed", application.userId, {
        applicationId: application.id,
        platform: apiConfig.platform,
        error: msg,
      });

      statsCache.totalSubmissions++;
      statsCache.failureCount++;

      log("error", "api_submission_failed", {
        applicationId: application.id,
        platform: apiConfig.platform,
        error: msg,
      });

      return {
        success: false,
        submissionId,
        submission,
        error: msg,
      };
    }
  }

  /**
   * Get strategy para enviar aplicação
   * Baseado em opening.platform e configuração
   */
  function determineSubmissionStrategy(application, config = {}) {
    const platform = application.openingSource?.toLowerCase();

    // Estratégia por plataforma
    const strategies = {
      linkedin: {
        method: "api",
        platform: "linkedin",
        requires: ["accessToken", "jobId"],
      },
      greenhouse: {
        method: "api",
        platform: "greenhouse",
        requires: ["accessToken", "jobId"],
      },
      lever: {
        method: "api",
        platform: "lever",
        requires: ["accessToken", "jobId"],
      },
      nerdin: {
        method: "email",
        targetEmail: "jobs@nerdin.com",
        requires: ["email"],
      },
      github: {
        method: "email",
        targetEmail: null, // Extrair de opening.url
        requires: ["email"],
      },
      // Default: email
      default: {
        method: "email",
        requires: ["email"],
      },
    };

    const strategy = strategies[platform] || strategies.default;

    // Validar requirements
    const missing = strategy.requires.filter(
      (req) => !config[req] && !application.submittedFields?.[req],
    );

    return {
      ...strategy,
      applicable: missing.length === 0,
      missingRequirements: missing,
    };
  }

  /**
   * Submete aplicação usando estratégia ideal (Tier 2)
   */
  async function submitApplication(application, userId, config = {}) {
    const strategy = determineSubmissionStrategy(application, config);

    if (!strategy.applicable) {
      log("warn", "submission_not_applicable", {
        applicationId: application.id,
        missing: strategy.missingRequirements,
      });

      return {
        success: false,
        strategy,
        error: `Configuração incompleta. Faltam: ${strategy.missingRequirements.join(", ")}`,
      };
    }

    if (strategy.method === "email") {
      const prepared = prepareForSubmission(application);

      if (!prepared.isReadyForSubmission) {
        return {
          success: false,
          prepared,
          error: prepared.submissionBlockers?.[0] || "Aplicação incompleta",
        };
      }

      const targetEmail =
        config.targetEmail || extractEmailFromOpening(application.openingUrl);

      return submitViaEmail(
        application,
        targetEmail,
        application.submittedFields.email,
      );
    } else if (strategy.method === "api") {
      return submitViaAPI(application, {
        ...strategy,
        ...config,
      });
    }

    return {
      success: false,
      error: `Strategy desconhecida: ${strategy.method}`,
    };
  }

  /**
   * Formata payload conforme plataforma específica
   */
  function formatPayloadForPlatform(application, platform) {
    const basePayload = {
      candidateEmail: application.submittedFields.email,
      candidateName: application.submittedFields.name,
      resume: application.submittedFields.resume,
      coverLetter:
        application.submittedFields.coverLetter ||
        application.submittedFields.message,
    };

    // Platform-specific formatting
    if (platform === "linkedin") {
      return {
        ...basePayload,
        jobId: application.openingId,
        submitTimeUTC: Math.floor(Date.now() / 1000),
      };
    }

    if (platform === "greenhouse") {
      return {
        ...basePayload,
        job_id: application.openingId,
        answers: [
          {
            question: "Cover Letter",
            answer:
              application.submittedFields.coverLetter ||
              "Candidatura enviada via Hunter",
          },
        ],
      };
    }

    if (platform === "lever") {
      return {
        ...basePayload,
        postingId: application.openingId,
        referrer: "hunter-app",
      };
    }

    return basePayload;
  }

  /**
   * Extrai email de um opening.url (fallback)
   */
  function extractEmailFromOpening(url) {
    // Simples heurística (em produção, usar crawling/parsing real)
    const emailMatch = url.match(/contact|jobs|careers|apply/i);
    return emailMatch ? "applications@company.com" : null;
  }

  /**
   * Retorna statísticas de submissões
   */
  function getStats() {
    return {
      ...statsCache,
      auditLogSize: auditLog.length,
    };
  }

  /**
   * Retorna audit log de submissões
   */
  function getAuditLog(filters = {}) {
    let log = [...auditLog];

    if (filters.userId) {
      log = log.filter((e) => e.userId === filters.userId);
    }
    if (filters.action) {
      log = log.filter((e) => e.action === filters.action);
    }

    return log.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Gera template de email para candidatura
   */
  function generateEmailTemplate(application) {
    return `
      <h2>Candidatura para: ${application.openingTitle}</h2>
      <p>Olá,</p>
      <p>Estou enviando minha candidatura para a posição de <strong>${application.openingTitle}</strong>.</p>
      <p>Segue em anexo meu currículo e carta de motivação.</p>
      <p>${application.submittedFields.message || application.submittedFields.coverLetter || ""}</p>
      <p>Fico no aguardo do seu recebimento.</p>
      <p>Atenciosamente,<br>
      <strong>${application.submittedFields.name || "Candidato"}</strong><br>
      ${application.submittedFields.email}</p>
    `;
  }

  // ============= PRIVATE =============

  function recordSubmission(userId, submissionId, submission) {
    if (!submissionCache.has(userId)) {
      submissionCache.set(userId, new Map());
    }
    submissionCache.get(userId).set(submissionId, submission);
  }

  function recordAudit(action, userId, details) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      userId,
      details,
    };

    auditLog.push(entry);
    statsCache.auditLogSize = auditLog.length;

    if (auditLog.length > MAX_AUDIT_SIZE) {
      auditLog.splice(0, auditLog.length - MAX_AUDIT_SIZE);
      statsCache.auditLogSize = auditLog.length;
    }
  }

  // ============= PUBLIC API =============

  return {
    prepareForSubmission,
    submitViaEmail,
    submitViaAPI,
    determineSubmissionStrategy,
    submitApplication,
    formatPayloadForPlatform,
    generateEmailTemplate,
    getStats,
    getAuditLog,
  };
}
