export function loadWorkerConfig(env = process.env) {
  return {
    databaseUrl: env.DATABASE_URL,
    huntPipelineMode: String(env.HUNT_PIPELINE_MODE ?? "direct_gateway"),
    pollIntervalMs: Number(env.WORKER_POLL_INTERVAL_MS ?? "3000"),
    maxBackoffMinutes: Number(env.WORKER_MAX_BACKOFF_MINUTES ?? "60"),
    mcpToolRetries: Number(env.MCP_TOOL_RETRIES ?? "2"),
    mcpToolRetryDelayMs: Number(env.MCP_TOOL_RETRY_DELAY_MS ?? "1200"),
    mcpScoreToolRetries: Number(env.MCP_SCORE_TOOL_RETRIES ?? "0"),
    mcpScoreRequestTimeoutMs: Number(
      env.MCP_SCORE_REQUEST_TIMEOUT_MS ?? "15000",
    ),
    mcpRankEnabled: String(env.MCP_RANK_ENABLED ?? "0") === "1",
    mcpRankToolRetries: Number(env.MCP_RANK_TOOL_RETRIES ?? "0"),
    mcpRankRequestTimeoutMs: Number(env.MCP_RANK_REQUEST_TIMEOUT_MS ?? "8000"),
    huntScoreConcurrency: Number(env.HUNT_SCORE_CONCURRENCY ?? "3"),
    huntScoreLlmTopK: Number(env.HUNT_SCORE_LLM_TOP_K ?? "12"),
    huntScoreLlmMinHeuristic: Number(env.HUNT_SCORE_LLM_MIN_HEURISTIC ?? "35"),
    huntMaxOpeningsToScore: Number(env.HUNT_MAX_OPENINGS_TO_SCORE ?? "40"),
    huntMaxOpeningsFromSearch: Number(
      env.HUNT_MAX_OPENINGS_FROM_SEARCH ?? "120",
    ),
    huntScoreProgressEvery: Number(env.HUNT_SCORE_PROGRESS_EVERY ?? "5"),
    huntPersistConcurrency: Number(env.HUNT_PERSIST_CONCURRENCY ?? "4"),
    huntMaxDurationMs: Number(env.HUNT_MAX_DURATION_MS ?? "900000"),
    huntScoreTimeoutContinue:
      String(env.HUNT_SCORE_TIMEOUT_CONTINUE ?? "1") === "1",
    interestingMatchScore: Number(env.NOTIFY_INTERESTING_MATCH_SCORE ?? "80"),
    once: process.argv.includes("--once"),
  };
}
