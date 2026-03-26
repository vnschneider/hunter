# Application Tracking Engine Contract (Phase 5)

**Propósito**: Rastrear aplicações de emprego desde submissão até resultado final, com auditoria completa e follow-ups automáticos.

**Padrão de Chamada**: Factory pattern com `createApplicationTrackingEngine(options, logger)`

---

## 1. API Public

### `createApplication(draftId, userId, opening, submittedFields, submittedBy)`

Cria uma nova aplicação (draft → application).

**Parâmetros**:

- `draftId` (string): ID do rascunho que originou esta aplicação
- `userId` (string): ID do usuário
- `opening` (object):
  - `id` ou `externalId`: identificador da vaga
  - `title`: título (ex: "Senior Node.js Engineer")
  - `url`: link para a vaga
  - `platform` ou `source`: origem (linkedin, nerdin, etc)
- `submittedFields` (object): Campos preenchidos (resume, cover letter, etc)
- `submittedBy` (string): "user" | "tier2_review" | "tier3_auto"

**Retorna**: Application object com status "submitted"

**Exemplo**:

```javascript
const app = trackingEngine.createApplication(
  "draft-123",
  "user-456",
  {
    id: "opening-789",
    title: "Senior Node.js Engineer",
    url: "https://linkedin.com/jobs/123",
    platform: "linkedin",
  },
  {
    resume: "...",
    coverLetter: "Sou desenvolvedor...",
  },
  "tier2_review"
);

// Retorna:
{
  id: "app-1711363200000-a1b2c3d",
  draftId: "draft-123",
  userId: "user-456",
  openingId: "opening-789",
  openingTitle: "Senior Node.js Engineer",
  openingUrl: "https://linkedin.com/jobs/123",
  openingSource: "linkedin",
  submittedFields: { resume: "...", coverLetter: "..." },
  submittedAt: "2025-03-25T10:00:00Z",
  submittedBy: "tier2_review",
  status: "submitted",
  statusHistory: [{status: "submitted", timestamp: "...", reason: "..."}],
  notes: [],
  lastStatusUpdate: "2025-03-25T10:00:00Z",
  followupAt: "2025-04-01T10:00:00Z",  // 7 dias depois se tier2/tier3
  flags: {
    hasInterview: false,
    hasRejection: false,
    isFollowupPending: true,
  },
}
```

---

### `updateApplicationStatus(applicationId, newStatus, userId, reason)`

Atualiza status da aplicação com validação de transições.

**Parâmetros**:

- `applicationId` (string): ID da aplicação
- `newStatus` (string): Novo status (ver STATUS enum)
- `userId` (string): ID do usuário (para validação)
- `reason` (string, opt): Motivo da mudança

**Status válidos**: "draft" → "submitted" → "pending" → "interview" | "rejected" → end

**Retorna**: Application object com novo status ou null se inválido

**Exemplo**:

```javascript
// Usuário recebeu entrevista
const updated = trackingEngine.updateApplicationStatus(
  "app-123",
  "interview",
  "user-456",
  "Email recebido da empresa para primeira entrevista",
);

// Rejeição após entrevista
const rejected = trackingEngine.updateApplicationStatus(
  "app-123",
  "rejected",
  "user-456",
  "Feedbackfoi que procuram experiência em Java",
);
```

---

### `addApplicationNote(applicationId, userId, note, noteType)`

Adiciona nota à aplicação (feedback, lembretes, etc).

**Parâmetros**:

- `applicationId` (string): ID da aplicação
- `userId` (string): ID do usuário
- `note` (string): Conteúdo da nota
- `noteType` (string, opt): "manual" | "system" | "interview_alert"

**Retorna**: Application object com nota adicionada

**Exemplo**:

```javascript
trackingEngine.addApplicationNote(
  "app-123",
  "user-456",
  "Aguardando feedback do RH. Enviar follow-up em 3 dias.",
  "manual",
);

// Nota automática do sistema
trackingEngine.addApplicationNote(
  "app-789",
  "user-456",
  "Seguimento automático: 7 dias sem resposta",
  "system",
);
```

---

### `withdrawApplication(applicationId, userId, reason)`

Retira uma aplicação (soft delete com razão).

**Parâmetros**:

- `applicationId` (string): ID da aplicação
- `userId` (string): ID do usuário
- `reason` (string, opt): Motivo da retirada

**Retorna**: Application object com status "withdrawn"

**Exemplo**:

```javascript
trackingEngine.withdrawApplication(
  "app-123",
  "user-456",
  "Aceitar oferta de outra empresa",
);
```

---

### `getApplications(userId, filters)`

Busca aplicações com filtros opcionais.

**Parâmetros**:

- `userId` (string): ID do usuário
- `filters` (object, opt):
  - `status`: "submitted" | "pending" | "interview" | "rejected" | etc
  - `source`: "linkedin" | "nerdin" | etc
  - `submittedBy`: "user" | "tier2_review" | "tier3_auto"
  - `fromDate` / `toDate`: range de datas

**Retorna**: Array de applications (mais recentes primeiro)

**Exemplo**:

```javascript
// Todas as aplicações em pendência
const pending = trackingEngine.getApplications("user-456", {
  status: "pending",
});

// Aplicações auto-enviadas pelo Tier 3 nesta semana
const autoSubmitted = trackingEngine.getApplications("user-456", {
  submittedBy: "tier3_auto",
  fromDate: "2025-03-18",
  toDate: "2025-03-25",
});

// Entrevistas marcadas
const interviews = trackingEngine.getApplications("user-456", {
  status: "interview",
});
```

---

### `getFollowupReminders(userId)`

Retorna aplicações que precisam de follow-up (7+ dias sem resposta).

**Parâmetros**:

- `userId` (string): ID do usuário

**Retorna**: Array de applications em followupAt <= now

**Exemplo**:

```javascript
const reminders = trackingEngine.getFollowupReminders("user-456");
// Len = 3 → usuário tem 3 aplicações esperando há 7+ dias

reminders.forEach((app) => {
  console.log(`Follow-up: ${app.openingTitle} (${app.openingSource})`);
  // Enviar email: "Verifique o status da sua candidatura em..."
});
```

---

### `getMetrics(userId)`

Retorna estatísticas de aplicações por período e categoria.

**Parâmetros**:

- `userId` (string): ID do usuário

**Retorna**: Object com:

- `total`: Total de aplicações
- `byStatus`: { submitted: N, pending: M, interview: K, ... }
- `bySource`: { linkedin: N, nerdin: M, ... }
- `bySubmitter`: { user: N, tier2_review: M, tier3_auto: K }
- `thisWeek`: Aplicações desta semana
- `averageSubmissionsPerDay`: Média (últimos 30 dias)

**Exemplo**:

```javascript
const metrics = trackingEngine.getMetrics("user-456");
// {
//   total: 45,
//   byStatus: { submitted: 5, pending: 20, interview: 12, rejected: 8 },
//   bySource: { linkedin: 30, nerdin: 15 },
//   bySubmitter: { user: 0, tier2_review: 30, tier3_auto: 15 },
//   thisWeek: 8,
//   averageSubmissionsPerDay: "1.50",
// }

// Dashboard: mostrar progresso
console.log(`Aguardando resposta: ${metrics.byStatus.pending}`);
console.log(`Entrevistas marcadas: ${metrics.byStatus.interview}`);
```

---

### `getApplication(applicationId, userId)`

Busca uma aplicação específica.

**Parâmetros**:

- `applicationId` (string): ID da aplicação
- `userId` (string): ID do usuário (para segurança)

**Retorna**: Application object ou null

---

### `getStats()`

Retorna estatísticas globais do engine.

**Retorna**:

```javascript
{
  totalApplications: 250,
  submittedCount: 50,
  pendingCount: 120,
  interviewCount: 45,
  rejectedCount: 25,
  acceptedCount: 5,
  withdrawnCount: 5,
  auditLogSize: 1243,
  lastHunt: "2025-03-25T10:00:00Z",
  cacheSize: 1,  // # users
}
```

---

### `getAuditLog(filters)`

Retorna log de auditoria completo.

**Parâmetros**:

- `filters` (object, opt):
  - `userId`: Filtrar por usuário
  - `action`: "application_created" | "status_updated" | "note_added" | ...
  - `fromDate` / `toDate`: Range de datas

**Retorna**: Array de audit entries (mais recentes primeiro)

**Exemplo**:

```javascript
const auditTrail = trackingEngine.getAuditLog({
  userId: "user-456",
  action: "status_updated",
});
// [{
//   timestamp: "2025-03-25T10:30:00Z",
//   action: "status_updated",
//   userId: "user-456",
//   details: {
//     applicationId: "app-123",
//     from: "submitted",
//     to: "pending",
//     reason: "Email de confirmação enviado",
//   },
// }]
```

---

### `clearCache()`

Limpa cache em-memória (para testes).

---

## 2. Enums e Constants

### `STATUS`

```javascript
{
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING: 'pending',
  INTERVIEW: 'interview',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
  ACCEPTED: 'accepted',
}
```

### `STATUS_TRANSITIONS`

Mapa de transições válidas por status. Ex: "submitted" → ["pending", "withdrawn"]

---

## 3. Database Schema

**Tabela: applications**

```sql
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  opening_id TEXT NOT NULL,
  opening_title TEXT,
  opening_url TEXT,
  opening_source TEXT,
  draft_id TEXT,
  submitted_fields JSONB,  -- {resume, coverLetter, ...}
  submitted_by TEXT,        -- 'user' | 'tier2_review' | 'tier3_auto'
  submitted_at TIMESTAMP,
  status TEXT,              -- 'submitted' | 'pending' | 'interview' | ...
  last_status_update TIMESTAMP,
  followup_at TIMESTAMP NULL,
  notes JSONB,              -- [{timestamp, content, type}, ...]
  created_at TIMESTAMP,
  updated_at TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (draft_id) REFERENCES application_drafts(id),
  INDEX (user_id, status),
  INDEX (submitted_at),
};
```

**Tabela: application_status_log** (auditoria)

```sql
CREATE TABLE application_status_log (
  id SERIAL PRIMARY KEY,
  application_id TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  changed_by TEXT,
  timestamp TIMESTAMP,
  reason TEXT,

  FOREIGN KEY (application_id) REFERENCES applications(id),
  INDEX (application_id),
  INDEX (timestamp),
};
```

---

## 4. Integração no Pipeline

**No `runDirectGatewayHunt()`**:

```javascript
// Después de generar drafts y persistirlos:
for (const draft of draftsGenerated) {
  const opening = scored.find((o) => o.id === draft.openingId);

  // Cria tracking (in-memory)
  trackingEngine.createApplication(
    draft.id,
    userId,
    opening,
    draft.fields,
    "tier2_review", // Aguardando aprovação do usuário
  );

  // Persiste no banco também
  await sql`INSERT INTO applications(...) VALUES(...)`;
}
```

**Workflow Tier 2 (Auto-fill)**:

```javascript
// Usuário recebe notificação de draft criado
// 1. Revisa draft
// 2. Clica "Enviar Aplicação"
// 3. Sistema chama updateApplicationStatus
trackingEngine.updateApplicationStatus(appId, "pending", userId, "Enviado");

// 4. Notifica empresa (HTTP POST / email / API)
// 5. Adiciona nota de acompanhamento
trackingEngine.addApplicationNote(appId, userId, "Enviado em 25/03");
```

**Workflow Tier 3 (Auto-submit)**:

```javascript
// Score >= 75 && allowed source && no excluded keywords
const app = trackingEngine.createApplication(
  draft.id,
  userId,
  opening,
  draft.fields,
  "tier3_auto", // ← indica auto-submit
);

// Agendar follow-up automático em 7 dias
// → followupAt é setado automaticamente

// Notificar usuário
sendEmail(user, `Aplicação auto-enviada: ${opening.title}`);
```

---

## 5. Exemplo Completo: Hunt → Tracking

```javascript
// Fase A: Hunt (encontrou vagas)
// Fase B: Scores (pontuou vagas)
// Fase D: Classificação e drafts (gerou rascunhos)

// Fase 5: Tracking (este engine)
// 1️⃣ Cria aplicações a partir dos drafts
for (const draft of draftsGenerated) {
  trackingEngine.createApplication(
    draft.id,
    userId,
    opening,
    draft.fields,
    "tier2_review",
  );
}

// 2️⃣ Usuário recebe notificação
onNotify("applications_ready_for_review", {
  count: draftsGenerated.length,
  message: "5 aplicações prontas para envio",
});

// 3️⃣ Usuário revisa e envia
// → Interface chama updateApplicationStatus(appId, 'pending')

// 4️⃣ Sistema envia aplicação à empresa
// → Pode ser email, LinkedIn API, Greenhouse API, etc

// 5️⃣ Tracking automático
// → getFollowupReminders() a cada 7 dias
// → Notificar se sem resposta
// → updateApplicationStatus(appId, 'interview') quando entrevista marcada

// 6️⃣ Relatório final
metrics = trackingEngine.getMetrics(userId);
// → 50 aplicações | 20 em resposta | 5 entrevistas | 2 aceitas
```

---

## 6. Status de Implementação

| Componente           | Status | Notas                                  |
| -------------------- | ------ | -------------------------------------- |
| Application creation | ✅     | Tier 2 + Tier 3 ready                  |
| Status transitions   | ✅     | Validação de workflow                  |
| Audit trail          | ✅     | Completo                               |
| Followup scheduling  | ✅     | 7 dias automático                      |
| Database persistence | ⏳     | Tabelas criadas, INSERT via worker.mjs |
| Tier 2 UI            | ⏳     | Avatar review interface (next)         |
| Tier 3 auto-submit   | ⏳     | After Tier 2 (next)                    |
| Email notifications  | ⏳     | After Tier 2 (next)                    |

---

## 7. Telemetria

```javascript
// Em cada hunt:
trackingStats = trackingEngine.getStats();
metrics = {
  totalApplications: trackingStats.totalApplications,
  pendingResponse: trackingStats.pendingCount,
  interviewsScheduled: trackingStats.interviewCount,
  acceptanceRate: (
    (trackingStats.acceptedCount / trackingStats.totalApplications) *
    100
  ).toFixed(2),
};
```

---

## 8. Performance

- **Criação de aplicação**: O(1) in-memory
- **Busca por userId**: O(1) cache lookup + O(n filters) onde n = # aplicações do usuário
- **Database persist**: Batch insert (não bloqueia hunt)
- **Follow-up check**: O(n) scan 1x/dia, rápido

---

## 9. Segurança

- ✅ **Isolamento por userId**: Each user sees only their applications
- ✅ **Auditoria completa**: Every action logged com timestamp e actor
- ✅ **Soft delete**: Retiradas não apagam história
- ✅ **Validation**: Status transitions validadas

---

## Próximas Fases

- **Tier 2**: Auto-fill + user approval (Next)
- **Tier 3**: Auto-submit com guardrails (After Tier 2)
- **Notifications**: Email + SMS alerts (After Tier 3)
- **Integrations**: LinkedIn, Greenhouse, BambooHR APIs
