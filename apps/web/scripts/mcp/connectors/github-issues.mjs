import { fetchJson, normalizeText } from "./shared.mjs";

const DEFAULT_REPOS = [
  { owner: "backend-br", repo: "vagas" },
  { owner: "frontendbr", repo: "vagas" },
];

function toOpening(issue, owner, repo) {
  const body = String(issue.body ?? "").slice(0, 6000);
  return {
    source: "github_issues",
    sourceId: `${owner}/${repo}#${issue.number}`,
    title: issue.title,
    companyName: owner,
    description: body,
    locationText: "Brazil",
    countryCode: "BR",
    remoteType: "unspecified",
    employmentType: null,
    seniority: null,
    skills: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    postedAt: issue.created_at,
    validThrough: null,
    applyUrl: issue.html_url,
    sourceUrl: issue.html_url,
    language: "pt-BR",
    metadata: {
      labels: issue.labels?.map((l) => l.name) ?? [],
      repository: `${owner}/${repo}`,
    },
  };
}

function matchesFilters(opening, filters) {
  const text = normalizeText(`${opening.title} ${opening.description}`);

  if (filters.keywords?.length) {
    const all = filters.keywords.map((k) => normalizeText(k));
    const hasAny = all.some((k) => text.includes(k));
    if (!hasAny) return false;
  }

  if (filters.excludedKeywords?.length) {
    const excluded = filters.excludedKeywords.map((k) => normalizeText(k));
    if (excluded.some((k) => text.includes(k))) return false;
  }

  return true;
}

export async function searchGithubIssues(filters = {}) {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const repos = filters.githubRepos?.length
    ? filters.githubRepos
    : DEFAULT_REPOS.map((r) => `${r.owner}/${r.repo}`);

  const state = filters.state ?? "open";
  const perPage = Math.min(100, Math.max(10, Number(filters.perPage ?? 30)));
  const since = filters.since;

  const all = [];
  for (const ref of repos) {
    const [owner, repo] = ref.split("/");
    if (!owner || !repo) continue;

    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
    url.searchParams.set("state", state);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", "1");
    if (since) url.searchParams.set("since", since);

    const issues = await fetchJson(url.toString(), { headers }, 15000);
    for (const issue of issues) {
      if (issue.pull_request) continue;
      const opening = toOpening(issue, owner, repo);
      if (matchesFilters(opening, filters)) {
        all.push(opening);
      }
    }
  }

  return all;
}
