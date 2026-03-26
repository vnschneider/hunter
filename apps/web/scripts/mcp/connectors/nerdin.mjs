import { fetchText, normalizeText, stripHtml } from "./shared.mjs";

function parseNerdin(html) {
  const items = [];
  const regex =
    /<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]{0,1800}?href="(https:\/\/www\.nerdin\.com\.br\/vaga_emprego\/[^"\s]+)"/gi;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const title = stripHtml(match[1])
      .replace(/\s+NOVA$/i, "")
      .trim();
    const url = match[2];
    if (!title || !url) continue;

    const snippet = html.slice(
      Math.max(0, match.index),
      Math.min(html.length, match.index + 2200),
    );
    const locationGuess =
      stripHtml(
        snippet.match(/(Home Office\/HO|[A-Za-zÀ-ÿ\s]+\/[A-Z]{2})/i)?.[1] ?? "",
      ) || null;

    items.push({
      source: "nerdin",
      sourceId: url,
      title,
      companyName: "Nerdin",
      description: `${title} ${locationGuess ?? ""}`,
      locationText: locationGuess,
      countryCode: "BR",
      remoteType:
        normalizeText(locationGuess).includes("home office") ||
        normalizeText(locationGuess).includes("ho")
          ? "remote"
          : "onsite",
      employmentType: null,
      seniority: null,
      skills: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: "BRL",
      postedAt: null,
      validThrough: null,
      applyUrl: url,
      sourceUrl: url,
      language: "pt-BR",
      metadata: {
        provider: "nerdin",
      },
    });
  }

  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.applyUrl)) return false;
    seen.add(item.applyUrl);
    return true;
  });
}

function matchesFilters(opening, filters) {
  const text = normalizeText(`${opening.title} ${opening.description}`);

  if (filters.keywords?.length) {
    const hasAny = filters.keywords
      .map((k) => normalizeText(k))
      .some((k) => text.includes(k));
    if (!hasAny) return false;
  }

  if (filters.excludedKeywords?.length) {
    const hasExcluded = filters.excludedKeywords
      .map((k) => normalizeText(k))
      .some((k) => text.includes(k));
    if (hasExcluded) return false;
  }

  return true;
}

export async function searchNerdin(filters = {}) {
  const pages = Math.min(
    3,
    Math.max(1, Number(filters.nerdinPages ?? process.env.NERDIN_PAGES ?? 1)),
  );
  const all = [];

  for (let page = 1; page <= pages; page++) {
    const url = new URL("https://www.nerdin.com.br/vagas.php");
    if (page > 1) {
      url.searchParams.set("page", String(page));
    }

    const html = await fetchText(url.toString(), {}, 20000);
    const parsed = parseNerdin(html).filter((o) => matchesFilters(o, filters));
    all.push(...parsed);

    if (parsed.length < 8) break;
  }

  return all;
}
