/**
 * Provider Gateway - Fase B
 *
 * Formaliza orquestração de múltiplos provedores de vagas com:
 * - Contrato unificado de entrada/saída
 * - Cache por fingerprint com TTL
 * - Telemetria por provider
 * - Timeout enforcement
 * - Degradação graciosa
 *
 * Entrada: { keywords, location, filters?, deadline? }
 * Saída: { openings: [], meta: { providers: [], totalElapsedMs, cacheHits } }
 */

/**
 * Cria hash/fingerprint para deduplicar requests
 * Baseado em: keywords + location + filtros normalizados
 */
export function buildSearchFingerprint(criteria) {
  const { keywords = "", location = "", filters = {} } = criteria;
  const keys = Object.keys(filters || {})
    .sort()
    .map((k) => `${k}=${JSON.stringify(filters[k])}`)
    .join("&");

  const fingerprint = `${keywords}|${location}|${keys}`;
  return fingerprint;
}

/**
 * Factory: cria gateway com cache local
 */
export function createProviderGateway(
  providersRegistry = {},
  logger = console,
) {
  const cache = new Map(); // fingerprint -> { result, timestamp, ttlMs }
  const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

  /**
   * Normaliza resultado de um provider para contrato unificado
   */
  function normalizeProviderResult(provider, rawResult, elapsedMs = 0) {
    const openings = Array.isArray(rawResult)
      ? rawResult
      : Array.isArray(rawResult?.openings)
        ? rawResult.openings
        : [];

    return {
      provider,
      count: openings.length,
      openings,
      elapsedMs,
      ok: true,
      error: null,
    };
  }

  /**
   * Orquestra busca em múltiplos providers com cache
   *
   * Parâmetros:
   *   criteria: { keywords, location, filters?, minConfidence? }
   *   deadline: timestamp em ms (timeout global)
   *   providersToUse?: array de nomes (ex: ['linkedin', 'nerdin'])
   *
   * Retorna: { openings, meta }
   */
  async function search(criteria, deadline = null, providersToUse = null) {
    const searchStartMs = Date.now();
    const fingerprint = buildSearchFingerprint(criteria);
    const providers = Object.keys(providersRegistry);

    // Respeita deadline se foi passado
    const timeRemainingMs = deadline ? deadline - searchStartMs : Infinity;
    if (timeRemainingMs <= 0) {
      return {
        openings: [],
        meta: {
          providers: [],
          totalElapsedMs: 0,
          cacheHits: 0,
          error: "DEADLINE_EXCEEDED",
        },
      };
    }

    // Filtra providers se foi especificado
    const activeProviders = providersToUse
      ? providers.filter((p) => providersToUse.includes(p))
      : providers;

    // Verifica cache
    const cached = cache.get(fingerprint);
    if (cached && Date.now() - cached.timestamp < cached.ttlMs) {
      logger.log("info", "provider-gateway: cache hit", {
        fingerprint,
        age: Date.now() - cached.timestamp,
      });
      return {
        openings: cached.result.openings,
        meta: {
          ...cached.result.meta,
          cacheHits: 1,
          cached: true,
        },
      };
    }

    // Busca em todos os providers em paralelo com timeout individual
    const promises = activeProviders.map(async (provider) => {
      const providerTimeoutMs = Math.min(25000, timeRemainingMs - 1000); // 25s ou tempo restante
      const providerStartMs = Date.now();

      try {
        const handler = providersRegistry[provider];
        if (!handler) {
          throw new Error(`Provider ${provider} not registered`);
        }

        // Executa com timeout
        const searchPromise = handler(criteria);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`TIMEOUT after ${providerTimeoutMs}ms`)),
            providerTimeoutMs,
          ),
        );

        const rawResult = await Promise.race([searchPromise, timeoutPromise]);
        const elapsedMs = Date.now() - providerStartMs;

        return normalizeProviderResult(provider, rawResult, elapsedMs);
      } catch (err) {
        const elapsedMs = Date.now() - providerStartMs;
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.log("error", `provider-gateway: ${provider} failed`, {
          error: errorMessage,
          elapsedMs,
        });

        return {
          provider,
          count: 0,
          openings: [],
          elapsedMs,
          ok: false,
          error: errorMessage,
        };
      }
    });

    const providerResults = await Promise.all(promises);
    const totalElapsedMs = Date.now() - searchStartMs;

    // Agrupa resultados
    const allOpenings = [];
    const providersMetaTelemetry = [];

    for (const result of providerResults) {
      if (result.ok && result.openings?.length > 0) {
        allOpenings.push(...result.openings);
      }
      providersMetaTelemetry.push({
        provider: result.provider,
        count: result.count,
        elapsedMs: result.elapsedMs,
        ok: result.ok,
        error: result.error || null,
      });
    }

    // Armazena resultado em cache
    const finalMeta = {
      providers: providersMetaTelemetry,
      totalElapsedMs,
      cacheHits: 0,
      cached: false,
    };

    cache.set(fingerprint, {
      result: { openings: allOpenings, meta: finalMeta },
      timestamp: searchStartMs,
      ttlMs: DEFAULT_CACHE_TTL_MS,
    });

    return {
      openings: allOpenings,
      meta: finalMeta,
    };
  }

  /**
   * Limpa cache manualmente
   */
  function clearCache() {
    cache.clear();
  }

  /**
   * Retorna stats do cache
   */
  function getCacheStats() {
    return {
      size: cache.size,
      entries: Array.from(cache.entries()).map(([fingerprint, data]) => ({
        fingerprint,
        age: Date.now() - data.timestamp,
        ttlMs: data.ttlMs,
        resultCount: data.result.openings?.length || 0,
      })),
    };
  }

  return {
    search,
    clearCache,
    getCacheStats,
    buildSearchFingerprint,
  };
}
