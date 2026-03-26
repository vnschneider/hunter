export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function buildOpeningDedupKey(opening) {
  const title = normalizeText(opening?.title);
  const company = normalizeText(opening?.company);
  const sourceUrl = normalizeText(opening?.sourceUrl);
  const applyUrl = normalizeText(opening?.applyUrl);

  if (sourceUrl) return `source_url:${sourceUrl}`;
  if (applyUrl) return `apply_url:${applyUrl}`;

  const sourceId = normalizeText(opening?.sourceId);
  if (sourceId) return `source_id:${sourceId}`;

  return `title:${title}|company:${company}`;
}

export function dedupeOpeningsLocal(openings) {
  const seen = new Set();
  const deduped = [];

  for (const opening of openings ?? []) {
    const key = buildOpeningDedupKey(opening);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(opening);
  }

  return deduped;
}

export function toPersistableOpening(opening, idx) {
  const platform = String(
    opening?.platform ?? opening?.source ?? opening?.provider ?? "unknown",
  );
  const externalId = String(
    opening?.externalId ??
      opening?.sourceId ??
      `${platform}:${opening?.sourceUrl ?? opening?.applyUrl ?? opening?.title ?? idx}`,
  );
  const title = String(opening?.title ?? "Vaga sem titulo");
  const url = String(
    opening?.url ?? opening?.applyUrl ?? opening?.sourceUrl ?? "",
  );
  const matchScore = Number(opening?.matchScore ?? opening?.score ?? 0);

  return {
    externalId,
    platform,
    title,
    url,
    matchScore,
  };
}
