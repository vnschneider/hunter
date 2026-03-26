import { fetchText, normalizeText, stripHtml } from "./shared.mjs";

function buildKeywords(filters = {}) {
  const joined = [
    ...(filters.keywords ?? []),
    ...(filters.jobTitles ?? []),
    ...(filters.skills ?? []),
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);

  return joined.length > 0 ? joined.join(" OR ") : "software engineer";
}

function buildLocation(filters = {}) {
  if (filters.linkedinLocation) {
    return String(filters.linkedinLocation);
  }

  if ((filters.targetCountries ?? []).includes("BR")) {
    return "Brazil";
  }

  return "Worldwide";
}

function parseLinkedinSearchUrl(filters = {}) {
  const raw =
    filters.linkedinSearchUrl ?? process.env.LINKEDIN_SEARCH_URL ?? "";
  if (!raw) return null;

  try {
    const url = new URL(String(raw));
    const keywords = url.searchParams.get("keywords") ?? undefined;
    const location = url.searchParams.get("location") ?? undefined;
    return {
      keywords,
      location,
      url: url.toString(),
    };
  } catch {
    return null;
  }
}

function extractLinkedinApplyUrls(html) {
  const matches =
    html.match(/https:\/\/[^"'\s]*linkedin\.com\/jobs\/view\/[^"'\s<]+/gi) ??
    [];
  const seen = new Set();
  const urls = [];

  for (const item of matches) {
    const cleaned = item.replace(/&amp;/g, "&");
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    urls.push(cleaned);
  }

  return urls;
}

function parseCards(html) {
  const cards = html.match(/<li[\s\S]*?<\/li>/gi) ?? [];
  const openings = [];

  for (const card of cards) {
    const linkMatch = card.match(
      /href="(https:\/\/[^"\s]*linkedin\.com\/jobs\/view\/[^"\s]+)"/i,
    );
    if (!linkMatch?.[1]) continue;

    const titleRaw = card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? "";
    const companyRaw =
      card.match(/<h4[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ??
      card.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ??
      "";
    const locationRaw =
      card.match(/base-search-card__location[^>]*>([\s\S]*?)<\/span>/i)?.[1] ??
      "";
    const timeIso = card.match(/<time[^>]*datetime="([^"]+)"/i)?.[1] ?? null;

    const title = stripHtml(titleRaw);
    if (!title) continue;

    openings.push({
      source: "linkedin",
      sourceId: linkMatch[1],
      title,
      companyName: stripHtml(companyRaw) || "LinkedIn",
      description: `${title} ${stripHtml(companyRaw)} ${stripHtml(locationRaw)}`,
      locationText: stripHtml(locationRaw) || null,
      countryCode: null,
      remoteType: "unspecified",
      employmentType: null,
      seniority: null,
      skills: [],
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: timeIso,
      validThrough: null,
      applyUrl: linkMatch[1],
      sourceUrl: linkMatch[1],
      language: "pt-BR",
      metadata: {
        provider: "linkedin-guest",
      },
    });
  }

  const seen = new Set();
  return openings.filter((o) => {
    if (seen.has(o.applyUrl)) return false;
    seen.add(o.applyUrl);
    return true;
  });
}

function parseFromSearchHtml(html) {
  const urls = extractLinkedinApplyUrls(html);
  return urls.map((url, idx) => ({
    source: "linkedin",
    sourceId: url,
    title: `LinkedIn Opportunity ${idx + 1}`,
    companyName: "LinkedIn",
    description: "Opportunity captured from LinkedIn search page",
    locationText: null,
    countryCode: null,
    remoteType: "unspecified",
    employmentType: null,
    seniority: null,
    skills: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: null,
    validThrough: null,
    applyUrl: url,
    sourceUrl: url,
    language: "pt-BR",
    metadata: {
      provider: "linkedin-search-page",
    },
  }));
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

export async function searchLinkedIn(filters = {}) {
  const searchUrlParams = parseLinkedinSearchUrl(filters);
  const keywords = searchUrlParams?.keywords ?? buildKeywords(filters);
  const location = searchUrlParams?.location ?? buildLocation(filters);
  const perPage = Math.min(25, Math.max(10, Number(filters.perPage ?? 25)));
  const pages = Math.min(
    4,
    Math.max(
      1,
      Number(filters.linkedinPages ?? process.env.LINKEDIN_PAGES ?? 2),
    ),
  );

  const all = [];

  if (searchUrlParams?.url) {
    try {
      const rawSearchHtml = await fetchText(searchUrlParams.url, {}, 20000);
      const parsedFromSearch = parseFromSearchHtml(rawSearchHtml).filter((o) =>
        matchesFilters(o, filters),
      );
      all.push(...parsedFromSearch);
    } catch {
      // fallback para endpoint guest
    }
  }

  for (let page = 0; page < pages; page++) {
    const start = page * perPage;
    const url = new URL(
      "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search",
    );
    url.searchParams.set("keywords", keywords);
    url.searchParams.set("location", location);
    url.searchParams.set("start", String(start));

    const html = await fetchText(url.toString(), {}, 20000);
    const parsed = parseCards(html).filter((o) => matchesFilters(o, filters));
    all.push(...parsed);

    if (parsed.length < 5) break;
  }

  const seen = new Set();
  return all.filter((item) => {
    const key = item.applyUrl ?? item.sourceUrl;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
