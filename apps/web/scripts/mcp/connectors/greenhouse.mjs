import { fetchJson, normalizeText } from "./shared.mjs";

function parseBoardTokens(filters = {}) {
  if (filters.greenhouseBoards?.length) return filters.greenhouseBoards;

  const env = process.env.GREENHOUSE_BOARD_TOKENS ?? "";
  return env
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toOpening(job, boardToken) {
  return {
    source: "greenhouse",
    sourceId: `${boardToken}:${job.id}`,
    title: job.title,
    companyName: boardToken,
    description: job.content ?? "",
    locationText: job.location?.name ?? null,
    countryCode: null,
    remoteType: "unspecified",
    employmentType: null,
    seniority: null,
    skills: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: job.updated_at,
    validThrough: null,
    applyUrl: job.absolute_url,
    sourceUrl: job.absolute_url,
    language: job.language ?? null,
    metadata: {
      boardToken,
      departments: job.departments ?? [],
      offices: job.offices ?? [],
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

  if (filters.targetCountries?.includes("BR")) {
    const location = normalizeText(opening.locationText);
    const looksBrazil =
      location.includes("brazil") ||
      location.includes("brasil") ||
      location.includes("sao paulo") ||
      location.includes("rio de janeiro") ||
      location.includes("remote");
    if (!looksBrazil) return false;
  }

  return true;
}

export async function searchGreenhouse(filters = {}) {
  const boards = parseBoardTokens(filters);
  if (!boards.length) return [];

  const all = [];

  for (const boardToken of boards) {
    const url = new URL(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`,
    );
    url.searchParams.set("content", "true");

    const data = await fetchJson(url.toString(), {}, 15000);
    const jobs = data.jobs ?? [];

    for (const job of jobs) {
      const opening = toOpening(job, boardToken);
      if (matchesFilters(opening, filters)) {
        all.push(opening);
      }
    }
  }

  return all;
}
