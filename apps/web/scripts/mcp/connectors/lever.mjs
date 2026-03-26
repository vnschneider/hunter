import { fetchJson, normalizeText } from "./shared.mjs";

function parseSites(filters = {}) {
  if (filters.leverSites?.length) return filters.leverSites;

  const env = process.env.LEVER_SITES ?? "";
  return env
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toOpening(job, site) {
  return {
    source: "lever",
    sourceId: `${site}:${job.id}`,
    title: job.text,
    companyName: site,
    description: job.descriptionPlain ?? job.description ?? "",
    locationText: job.categories?.location ?? null,
    countryCode: job.country ?? null,
    remoteType: job.workplaceType ?? "unspecified",
    employmentType: job.categories?.commitment ?? null,
    seniority: null,
    skills: [],
    salaryMin: job.salaryRange?.min ?? null,
    salaryMax: job.salaryRange?.max ?? null,
    salaryCurrency: job.salaryRange?.currency ?? null,
    postedAt: null,
    validThrough: null,
    applyUrl: job.applyUrl,
    sourceUrl: job.hostedUrl,
    language: null,
    metadata: {
      site,
      team: job.categories?.team ?? null,
      department: job.categories?.department ?? null,
      allLocations: job.categories?.allLocations ?? [],
    },
  };
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

  if (filters.workArrangement === "remote") {
    const isRemote = ["remote", "hybrid"].includes(
      normalizeText(opening.remoteType),
    );
    if (!isRemote) return false;
  }

  if (filters.targetCountries?.includes("BR")) {
    const country = normalizeText(opening.countryCode);
    const location = normalizeText(opening.locationText);
    const looksBrazil =
      country === "br" ||
      location.includes("brazil") ||
      location.includes("brasil") ||
      location.includes("remote");
    if (!looksBrazil) return false;
  }

  return true;
}

export async function searchLever(filters = {}) {
  const sites = parseSites(filters);
  if (!sites.length) return [];

  const all = [];

  for (const site of sites) {
    try {
      const url = new URL(`https://api.lever.co/v0/postings/${site}`);
      url.searchParams.set("mode", "json");
      url.searchParams.set(
        "limit",
        String(Math.min(100, Number(filters.perPage ?? 50))),
      );
      url.searchParams.set("skip", "0");

      const jobs = await fetchJson(url.toString(), {}, 15000);
      for (const job of jobs ?? []) {
        const opening = toOpening(job, site);
        if (matchesFilters(opening, filters)) {
          all.push(opening);
        }
      }
    } catch {
      // Ignora sites inválidos/indisponíveis para não bloquear todo o provider.
      continue;
    }
  }

  return all;
}
