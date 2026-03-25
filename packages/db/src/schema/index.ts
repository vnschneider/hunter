import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  bigint,
  boolean,
  smallint,
  uniqueIndex,
  index,
  pgEnum,
  bigserial,
} from "drizzle-orm/pg-core";

export const huntStatusEnum = pgEnum("hunt_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "processing",
  "done",
  "dead",
]);

export const jobTypeEnum = pgEnum("job_type", [
  "run_hunt",
  "generate_strategy",
]);

export const applicationStatusEnum = pgEnum("application_status", [
  "suggested",
  "shortlisted",
  "queued",
  "applying",
  "applied",
  "failed",
  "skipped",
]);

export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  googleSub: text("google_sub").unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cvs = pgTable(
  "cvs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    extractedText: text("extracted_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cvs_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const strategies = pgTable(
  "strategies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    cvId: uuid("cv_id").references(() => cvs.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    criteriaJson: jsonb("criteria_json").notNull().$type<Record<string, unknown>>(),
    promptText: text("prompt_text").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("strategies_user_idx").on(t.userId)],
);

export const hunts = pgTable(
  "hunts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    strategyId: uuid("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "restrict" }),
    strategySnapshotJson: jsonb("strategy_snapshot_json")
      .notNull()
      .$type<Record<string, unknown>>(),
    status: huntStatusEnum("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    exportStoragePath: text("export_storage_path"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("hunts_user_started_idx").on(t.userId, t.startedAt),
    index("hunts_status_idx").on(t.status),
  ],
);

export const openings = pgTable(
  "openings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(),
    externalId: text("external_id"),
    normalizedUrl: text("normalized_url").notNull(),
    title: text("title").notNull(),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("openings_platform_url_uidx").on(t.platform, t.normalizedUrl),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.userId, { onDelete: "cascade" }),
    huntId: uuid("hunt_id")
      .notNull()
      .references(() => hunts.id, { onDelete: "cascade" }),
    openingId: uuid("opening_id")
      .notNull()
      .references(() => openings.id, { onDelete: "cascade" }),
    openingUrl: text("opening_url").notNull(),
    sourceUrl: text("source_url"),
    status: applicationStatusEnum("status").notNull().default("suggested"),
    matchScore: smallint("match_score"),
    notes: text("notes"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("applications_user_status_idx").on(t.userId, t.status),
    index("applications_hunt_idx").on(t.huntId),
    uniqueIndex("applications_user_opening_hunt_uidx").on(
      t.userId,
      t.openingId,
      t.huntId,
    ),
  ],
);

export const huntEvents = pgTable(
  "hunt_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    huntId: uuid("hunt_id")
      .notNull()
      .references(() => hunts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("hunt_events_hunt_created_idx").on(t.huntId, t.createdAt),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: jobTypeEnum("type").notNull(),
    userId: text("user_id").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    idempotencyKey: text("idempotency_key").unique(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("jobs_queue_idx").on(t.status, t.runAfter),
  ],
);
