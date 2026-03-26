# Application Engine - Fase D: Contrato de API

**Status:** ✅ Implementado em `apps/web/scripts/worker/core/application-engine.mjs`

## Visão Geral

O Application Engine classifica vagas de acordo com confiança + estratégia, gera drafts para revisão e oferece um fluxo seguro de candidatura assistida com 3 níveis de automação e auditoria completa.

## Estrutura do Módulo

```javascript
import { createApplicationEngine } from "./worker/core/application-engine.mjs";

const appEngine = createApplicationEngine(config, logger);
```

### Parâmetros de Inicialização

- **`config`** (Object, opcional): Configurações engine (futuro: TTL, batch size)
- **`logger`** (Object, opcional): Objeto com método `.log(level, message, extra)`

## API Pública

### `appEngine.classifyMany(openings, profile, strategy?)`

Classifica múltiplas vagas de acordo com score + estratégia.

**Parâmetros:**

```typescript
interface Opening {
  source: string; // Provider (linkedin, nerdin, etc)
  sourceId: string; // ID único
  sourceUrl: string; // URL canônica
  applyUrl: string; // URL de candidatura
  title: string;
  companyName: string;
  description: string;
  matchScore: number; // Score do scoring-engine (0-100)
}

interface Profile {
  keywords?: string[];
  skills?: string[];
  fullName?: string;
  email?: string;
  phone?: string;
  currentLocation?: string;
  linkedInUrl?: string;
  portfolioUrl?: string;
  resumeText?: string;
}

interface Strategy {
  autoApplyThreshold?: number; // Default: 75
  reviewThreshold?: number; // Default: 50
  allowedAutoApplySources?: string[]; // Default: ["linkedin", "nerdin"]
  excludedKeywords?: string[]; // Ex: ["deprecated", "legacy"]
}
```

**Retorna:**

```typescript
[{
  opening: Opening;
  classification: {
    class: "auto_apply_candidate" | "review_recommended" | "keep_for_later";
    reason: "high_confidence_allowed_source" | "medium_confidence_or_new_source" | "excluded_keywords" | "low_confidence";
    score: number;
  }
}]
```

**Exemplo:**

```javascript
const openings = [
  {
    source: "linkedin",
    sourceId: "123456",
    sourceUrl: "https://...",
    applyUrl: "https://...",
    title: "Senior TypeScript Engineer",
    companyName: "TechCorp",
    description: "...",
    matchScore: 85,
  },
  // ... mais vagas
];

const classifications = appEngine.classifyMany(openings, userProfile, {
  autoApplyThreshold: 75, // 75+ → auto-apply
  reviewThreshold: 50, // 50-74 → review
  allowedAutoApplySources: ["linkedin", "nerdin"],
  excludedKeywords: ["deprecated", "legacy", "unpaid"],
});

classifications.forEach((item) => {
  console.log(
    `${item.opening.title}: ${item.classification.class} (${item.classification.score})`,
  );
});
// Output:
// Senior TypeScript Engineer: auto_apply_candidate (85)
// Mid-level Admin: review_recommended (62)
// Junior Helper: keep_for_later (35)
```

### `appEngine.generateDraftsForReview(classified, userId, profile)`

Gera drafts para vagas classificadas como `review_recommended`.

**Parâmetros:**

```typescript
classified: resultado de classifyMany()        // Só genera drafts para "review_recommended"
userId: string                                 // ID do utilizador
profile: Profile                               // Dados para preencher fields
```

**Retorna:**

```typescript
[{
  draftId: string;                    // ID único do draft
  userId: string;
  openingId: string;
  openingSource: string;
  openingUrl: string;
  jobTitle: string;
  companyName: string;
  classification: string;             // "review_recommended"
  confidenceScore: number;
  classificationReason: string;
  fields: {                           // Pré-preenchidos do profile
    fullName: string;
    email: string;
    phone: string;
    location: string;
    linkedInUrl: string;
    portfolioUrl: string;
    coverLetter: string;              // Vazio, user preenche
    experience: string;
  };
  appliedAt: null;                    // Preenchido quando submitted
  appliedVia: "auto_draft";
  createdAt: ISO8601;
  updatedAt: ISO8601;
  status: "draft";                    // "draft" | "reviewing" | "submitted" | "rejected"
  auditTrail: [{
    action: string;
    timestamp: ISO8601;
    actor: string;                    // "system" | "user:123"
    details: string;
  }];
}]
```

**Exemplo:**

```javascript
const drafts = appEngine.generateDraftsForReview(
  classifications,
  userId,
  userProfile,
);

console.log(`${drafts.length} drafts created for review`);
drafts.forEach((draft) => {
  console.log(`Draft: ${draft.jobTitle} at ${draft.companyName}`);
  console.log(`  URL: ${draft.openingUrl}`);
  console.log(`  Status: ${draft.status}`);
});
```

### `appEngine.approveDraftForReview(draftId, userId, notes?)`

Utilizador aprova um draft para candidatura manual.

**Retorna:** Draft atualizado (status="reviewing")

```javascript
const draft = appEngine.approveDraftForReview(
  draftId,
  userId,
  "Looks good, ready to apply",
);
console.log(`Draft ${draft.draftId} approved for review`);
```

### `appEngine.rejectDraft(draftId, userId, reason?)`

Utilizador rejeita um draft (não candidatura).

**Retorna:** Draft atualizado (status="rejected")

```javascript
const draft = appEngine.rejectDraft(draftId, userId, "Too junior for my level");
console.log(`Draft rejected: ${reason}`);
```

### `appEngine.submitDraft(draftId, userId, overrideFields?)`

Submete um draft como candidatura oficial.

**Parâmetros:**

```typescript
draftId: string;
userId: string;
overrideFields?: {        // User-edits (optional)
  fullName?: string;
  email?: string;
  coverLetter?: string;
  // ... outros fields
}
```

**Retorna:**

```typescript
{
  applicationId: string;           // ID da candidatura
  draftId: string;                 // Source draft
  userId: string;
  openingId: string;
  openingSource: string;
  jobTitle: string;
  companyName: string;
  confidenceScore: number;
  submittedFields: {               // All fields sent
    fullName: string;
    email: string;
    // ...
  };
  submittedAt: ISO8601;
  status: "submitted";
  auditTrail: [{
    action: "submitted";
    timestamp: ISO8601;
    actor: "user:123";
    details: "Submitted with overrides: coverLetter, linkedInUrl";
  }];
}
```

**Exemplo:**

```javascript
const application = appEngine.submitDraft(draftId, userId, {
  coverLetter: "Custom letter for this role...",
  email: "alternate@email.com", // Override se necessário
});

console.log(`Application ${application.applicationId} submitted`);
console.log(`Submitted at: ${application.submittedAt}`);
console.log(`Fields sent:`, Object.keys(application.submittedFields));
```

### `appEngine.getStats()`

Retorna estatísticas de classificação e aplicações.

**Retorna:**

```typescript
{
  totalClassified: number; // Total vagas classificadas
  autoApplyCandidates: number; // Classe "auto_apply_candidate"
  reviewRecommended: number; // Classe "review_recommended"
  keepForLater: number; // Classe "keep_for_later"
  draftsCreated: number; // Drafts gerados
  draftSubmitted: number; // Drafts submetidos
  draftsInCache: number; // Drafts em memória agora
  auditLogSize: number; // Entradas de auditoria
}
```

**Exemplo:**

```javascript
const stats = appEngine.getStats();
console.log(`
  Classified: ${stats.totalClassified}
  Auto-apply: ${stats.autoApplyCandidates}
  Review: ${stats.reviewRecommended}
  Submitted: ${stats.draftSubmitted}
`);
```

### `appEngine.getAuditLog(filters?)`

Retorna audit trail com filtros opcionais.

**Parâmetros:**

```typescript
filters?: {
  userId?: string;        // Filter by user
  action?: string;        // Filter by action
  since?: ISO8601;        // Filter by timestamp
}
```

**Retorna:**

```typescript
[{
  timestamp: ISO8601;
  action: string;         // "draft_created" | "draft_approved" | "draft_rejected" | "application_submitted" | ...
  userId: string;
  details: object;        // Context-specific data
}]
```

**Exemplo:**

```javascript
const auditLog = appEngine.getAuditLog({
  userId: "user-123",
  action: "application_submitted",
});

auditLog.forEach((entry) => {
  console.log(`${entry.timestamp}: ${entry.action}`);
  console.log(`  Details:`, entry.details);
});
```

### `appEngine.getDraft(draftId)`

Retorna um draft específico.

```javascript
const draft = appEngine.getDraft(draftId);
if (draft) {
  console.log(`Draft status: ${draft.status}`);
  console.log(`Score: ${draft.confidenceScore}`);
}
```

### `appEngine.getUserDrafts(userId, status?)`

Retorna todos os drafts de um utilizador (com filtro opcional por status).

```javascript
const reviewDrafts = appEngine.getUserDrafts(userId, "draft");
console.log(`${reviewDrafts.length} drafts awaiting review`);

const allDrafts = appEngine.getUserDrafts(userId);
console.log(`${allDrafts.length} total drafts (all statuses)`);
```

### `appEngine.clearCache()`

Limpa cache de drafts (não afeta audit log).

```javascript
appEngine.clearCache();
```

## Fluxo de Candidatura: 3 Níveis de Automação

### Tier 1: Sugestão (Default)

```
Opening (score 65) → Classification "review_recommended" → Draft criado → User aprova/rejeita
```

- User sempre revê antes de candidatura
- User pode editar campos antes enviar
- Garantido: trilha de auditoria completa

### Tier 2: Auto-Fill + Confirm (Future)

```
Opening (score 75) → Classification "auto_apply_candidate" → Draft criado + Auto-filled → User confirma envio
```

- Draft pre-preenchido com dados do profile
- User apenas confirma (sem edição necessária)
- Rápido: ~30 segundos por vaga

### Tier 3: Auto-Submit (Restricted)

```
Opening (score 85+) + allowed_source (LinkedIn/Nerdin) → Direct submission → audit log
```

- Sem user intervention
- Apenas em sources brancas (LinkedIn, Nerdin)
- Audit log registra tudo
- Rollback possível (retract application)

## Características Principais

### 1. Classificação Inteligente

```
score >= 75 + source branca → auto_apply_candidate
score >= 50 + score < 75   → review_recommended
score < 50 ou excludedKw   → keep_for_later
excluded_keywords sempre   → keep_for_later
```

### 2. Trilha de Auditoria Completa

Cada ação registrada:

- Draft criado/aprovado/rejeitado
- Campos modificados
- Timestamps
- Actor (system vs user)
- Contexto (score, source, reason)

### 3. Política Segura

- Nunca envia candidatura sem auditoria
- User sempre pode rejeitar
- Override fields rastreados
- Exclusões por keyword

### 4. Performance

- Draft generation: O(n) com n = vagas
- Cache em memória (até 10,000 drafts)
- Audit log com queries (filtro por userId, action, date)

## Integração no Worker

No `processRunHunt()` após scoring:

```javascript
import { createApplicationEngine } from "./worker/core/application-engine.mjs";

const appEngine = createApplicationEngine({}, logger);

// ... após scoring e ranking ...

// 4. Classificar vagas
const classified = appEngine.classifyMany(rankedOpenings, strategySnapshot, {
  autoApplyThreshold: strategySnapshot.autoApplyThreshold ?? 75,
  reviewThreshold: strategySnapshot.reviewThreshold ?? 50,
  allowedAutoApplySources: strategySnapshot.allowedAutoApplySources ?? [
    "linkedin",
    "nerdin",
  ],
  excludedKeywords: strategySnapshot.excludedKeywords ?? [],
});

// 5. Gerar drafts para revisão
const drafts = appEngine.generateDraftsForReview(
  classified,
  hunt.user_id,
  strategySnapshot,
);

// Persist drafts to DB
for (const draft of drafts) {
  await sql`
    insert into application_drafts (
      draft_id, user_id, opening_id, opening_source, opening_url,
      job_title, company_name, confidence_score, classification,
      fields_json, status, created_at
    ) values (
      ${draft.draftId}, ${hunt.user_id}, ${draft.openingId}, 
      ${draft.openingSource}, ${draft.openingUrl}, ${draft.jobTitle}, 
      ${draft.companyName}, ${draft.confidenceScore}, 
      ${draft.classification}, ${JSON.stringify(draft.fields)}, 
      ${draft.status}, ${draft.createdAt}
    )
  `;
}

// Emit evento
await emitHuntEvent(huntId, hunt.user_id, "hunt_progress", {
  phase: "applications_ready",
  message: `${drafts.length} candidaturas prontas para revisão`,
  autoCandidates: classified.filter(
    (c) => c.classification.class === "auto_apply_candidate",
  ).length,
  reviewDrafts: drafts.length,
});
```

## Database Schema

```sql
-- Drafts
CREATE TABLE application_drafts (
  id SERIAL PRIMARY KEY,
  draft_id VARCHAR(100) UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  opening_id VARCHAR(200) NOT NULL,
  opening_source VARCHAR(50) NOT NULL,
  opening_url TEXT NOT NULL,
  job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  confidence_score INTEGER,
  classification VARCHAR(50),  -- "draft", "reviewing", "submitted", "rejected"
  fields_json JSONB,           -- fullName, email, phone, coverLetter, etc
  status VARCHAR(50) NOT NULL, -- draft | reviewing | submitted | rejected
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_user_status (user_id, status)
);

-- Submitted applications
CREATE TABLE applications (
  id SERIAL PRIMARY KEY,
  application_id VARCHAR(100) UNIQUE NOT NULL,
  draft_id VARCHAR(100) REFERENCES application_drafts(draft_id),
  user_id UUID NOT NULL REFERENCES users(id),
  opening_id VARCHAR(200) NOT NULL,
  opening_source VARCHAR(50) NOT NULL,
  job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  confidence_score INTEGER,
  submitted_fields_json JSONB,  -- What was actually sent
  submitted_at TIMESTAMP NOT NULL,
  status VARCHAR(50) DEFAULT 'submitted', -- submitted | reviewed | rejected | error
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_user_source (user_id, opening_source)
);

-- Audit trail
CREATE TABLE application_audit_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT NOW(),
  action VARCHAR(100) NOT NULL,
  user_id UUID REFERENCES users(id),
  details JSONB,
  INDEX idx_user_action (user_id, action)
);
```

## Status de Integração

| Componente           | Status     | Detalhes                         |
| -------------------- | ---------- | -------------------------------- |
| Classification       | ✅ Pronto  | classifyMany(), 3-tier system    |
| Draft Generation     | ✅ Pronto  | generateDraftsForReview()        |
| Draft Actions        | ✅ Pronto  | approve, reject, submit          |
| Audit Trail          | ✅ Pronto  | getAuditLog() com filtros        |
| DB Persistence       | ⏳ Próximo | Integration com worker           |
| UI Flow              | ⏳ Futuro  | Next.js dashboard                |
| Auto-Submit (Tier 3) | ⏳ Futuro  | Requires user confirmation first |

## Roadmap Futuro

- **Tier 2 Auto-Fill**: Pre-fill drafts com profile data
- **Tier 3 Auto-Submit**: Direct submit com restrictions
- **Application Tracking**: Follow-up on submitted applications
- **Email Integration**: Notify user on draft creation
- **Bulk Operations**: Submit múltiplos drafts em batch
- **Rollback**: Retract submitted applications
