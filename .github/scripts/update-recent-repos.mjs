import { readFile, writeFile } from "node:fs/promises";

const README_PATH = "README.md";
const RECENT_REPOS_START_MARKER = "<!-- RECENT_REPOS:START -->";
const RECENT_REPOS_END_MARKER = "<!-- RECENT_REPOS:END -->";
const LANGUAGE_SNAPSHOT_START_MARKER = "<!-- LANGUAGE_SNAPSHOT:START -->";
const LANGUAGE_SNAPSHOT_END_MARKER = "<!-- LANGUAGE_SNAPSHOT:END -->";

const owner =
  process.env.GITHUB_REPOSITORY_OWNER ??
  process.env.GITHUB_USERNAME ??
  "ravano-2464";
const recentRepoLimit = Number.parseInt(process.env.RECENT_REPO_LIMIT ?? "7", 10);
const topLanguageLimit = Number.parseInt(process.env.TOP_LANGUAGE_LIMIT ?? "6", 10);

const FRONTEND_LANGUAGES = new Set([
  "HTML",
  "CSS",
  "SCSS",
  "Sass",
  "Less",
  "Stylus",
  "Vue",
  "Svelte",
  "Astro",
  "MDX",
]);

const BACKEND_LANGUAGES = new Set([
  "Python",
  "Java",
  "Go",
  "PHP",
  "Ruby",
  "Rust",
  "Kotlin",
  "C#",
  "C++",
  "C",
  "Scala",
  "Elixir",
  "Haskell",
  "Lua",
  "R",
]);

const AMBIGUOUS_LANGUAGES = new Set(["JavaScript", "TypeScript"]);

const FRONTEND_KEYWORDS = [
  "frontend",
  "front-end",
  "ui",
  "ux",
  "web",
  "website",
  "landing",
  "portfolio",
  "template",
  "client",
  "react",
  "next",
  "vue",
  "svelte",
  "expo",
  "mobile",
];

const BACKEND_KEYWORDS = [
  "backend",
  "back-end",
  "api",
  "server",
  "microservice",
  "service",
  "auth",
  "database",
  "db",
  "bot",
  "automation",
  "scraper",
  "crawler",
  "fastapi",
  "spring",
  "nestjs",
  "django",
  "flask",
];

const LANGUAGE_BADGE_STYLES = {
  TypeScript: { color: "3178C6", logo: "typescript", logoColor: "white" },
  JavaScript: { color: "F7DF1E", logo: "javascript", logoColor: "000000" },
  HTML: { color: "E34F26", logo: "html5", logoColor: "white" },
  CSS: { color: "1572B6", logo: "css3", logoColor: "white" },
  Java: { color: "007396", logo: "openjdk", logoColor: "white" },
  Python: { color: "3776AB", logo: "python", logoColor: "white" },
  PHP: { color: "777BB4", logo: "php", logoColor: "white" },
  Go: { color: "00ADD8", logo: "go", logoColor: "white" },
  Rust: { color: "000000", logo: "rust", logoColor: "white" },
  Kotlin: { color: "7F52FF", logo: "kotlin", logoColor: "white" },
  Vue: { color: "4FC08D", logo: "vuedotjs", logoColor: "white" },
  Svelte: { color: "FF3E00", logo: "svelte", logoColor: "white" },
  C: { color: "A8B9CC", logo: "c", logoColor: "000000" },
  "C++": { color: "00599C", logo: "cplusplus", logoColor: "white" },
  "C#": { color: "239120", logo: "csharp", logoColor: "white" },
};

function toDateString(value) {
  if (!value) return "-";
  const date = new Date(value);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const day = date.getUTCDate();
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

function pluralizeRepo(count) {
  return count === 1 ? "repo" : "repos";
}

function buildRecentReposTable(repositories) {
  const header = ["| Repository | Main Language | Last Update |", "|---|---|---|"];

  const rows = repositories.map((repo) => {
    const name = repo.name ?? "Unknown";
    const url = repo.html_url ?? "#";
    const language = repo.language ?? "-";
    const lastUpdate = toDateString(repo.pushed_at ?? repo.updated_at);
    return `| [${name}](${url}) | ${language} | ${lastUpdate} |`;
  });

  return [...header, ...rows].join("\n");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceBlock(content, startMarker, endMarker, replacement) {
  if (!content.includes(startMarker) || !content.includes(endMarker)) {
    throw new Error(
      `Markers not found in README. Expected ${startMarker} and ${endMarker}.`,
    );
  }

  const block = `${startMarker}\n${replacement}\n${endMarker}`;
  const pattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`,
    "m",
  );

  return content.replace(pattern, block);
}

async function fetchRepositories(username) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "readme-profile-updater",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const repositories = [];
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/users/${username}/repos`);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("type", "owner");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("Unexpected GitHub API response.");
    }

    repositories.push(...data);
    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  return repositories
    .filter((repo) => !repo.fork && !repo.archived && repo.name !== username)
    .sort((a, b) => Date.parse(b.pushed_at ?? b.updated_at ?? 0) - Date.parse(a.pushed_at ?? a.updated_at ?? 0));
}

function countLanguages(repositories) {
  const counts = new Map();

  for (const repo of repositories) {
    const language = repo.language?.trim();
    if (!language) {
      continue;
    }

    counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}

function buildBadge({ label, message, color, logo, logoColor }) {
  const encodedLabel = encodeURIComponent(label);
  const encodedMessage = encodeURIComponent(message);
  let src = `https://img.shields.io/badge/${encodedLabel}-${encodedMessage}-${color}?style=for-the-badge`;

  const params = [];
  if (logo) {
    params.push(`logo=${encodeURIComponent(logo)}`);
  }
  if (logoColor) {
    params.push(`logoColor=${encodeURIComponent(logoColor)}`);
  }
  if (params.length > 0) {
    src += `&${params.join("&")}`;
  }

  return `<img src="${src}" alt="${label}" />`;
}

function buildLanguageBadges(languageCounts) {
  const topLanguages = languageCounts.slice(0, topLanguageLimit);
  if (topLanguages.length === 0) {
    return "<p align=\"left\">No language data available.</p>";
  }

  const badges = topLanguages.map(({ language, count }) => {
    const style = LANGUAGE_BADGE_STYLES[language] ?? {
      color: "6E7781",
      logo: "github",
      logoColor: "white",
    };

    return buildBadge({
      label: language,
      message: `${count} ${pluralizeRepo(count)}`,
      color: style.color,
      logo: style.logo,
      logoColor: style.logoColor,
    });
  });

  return `<p align="left">\n  ${badges.join("\n  ")}\n</p>`;
}

function containsKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function classifyRepository(repo) {
  const language = repo.language ?? "";
  const text = [
    repo.name ?? "",
    repo.description ?? "",
    ...(Array.isArray(repo.topics) ? repo.topics : []),
  ]
    .join(" ")
    .toLowerCase();

  if (BACKEND_LANGUAGES.has(language)) {
    return "backend";
  }

  if (FRONTEND_LANGUAGES.has(language)) {
    return "frontend";
  }

  if (AMBIGUOUS_LANGUAGES.has(language)) {
    const looksBackend = containsKeyword(text, BACKEND_KEYWORDS);
    const looksFrontend = containsKeyword(text, FRONTEND_KEYWORDS);

    if (looksBackend && !looksFrontend) {
      return "backend";
    }
    if (looksFrontend && !looksBackend) {
      return "frontend";
    }
    return "frontend";
  }

  if (containsKeyword(text, BACKEND_KEYWORDS)) {
    return "backend";
  }

  if (containsKeyword(text, FRONTEND_KEYWORDS)) {
    return "frontend";
  }

  return "other";
}

function countRepositoryDomains(repositories) {
  return repositories.reduce(
    (accumulator, repo) => {
      const classification = classifyRepository(repo);
      accumulator[classification] += 1;
      return accumulator;
    },
    { frontend: 0, backend: 0, other: 0 },
  );
}

function buildLanguageSnapshot(repositories) {
  const languageCounts = countLanguages(repositories);
  const domainCounts = countRepositoryDomains(repositories);
  const languageBadges = buildLanguageBadges(languageCounts);

  return [
    "_Automatically generated from active, non-fork public repositories. Counts represent each repository's primary language._",
    "",
    languageBadges,
    "",
    `- **Frontend repositories:** ${domainCounts.frontend}`,
    `- **Backend repositories:** ${domainCounts.backend}`,
    `- **Other or mixed repositories:** ${domainCounts.other}`,
    `- **Total repositories analyzed:** ${repositories.length}`,
  ].join("\n");
}

async function main() {
  const repositories = await fetchRepositories(owner);
  const recentRepositories = repositories.slice(0, recentRepoLimit);
  const recentTable = buildRecentReposTable(recentRepositories);
  const languageSnapshot = buildLanguageSnapshot(repositories);

  const readme = await readFile(README_PATH, "utf8");
  let updated = replaceBlock(
    readme,
    RECENT_REPOS_START_MARKER,
    RECENT_REPOS_END_MARKER,
    recentTable,
  );
  updated = replaceBlock(
    updated,
    LANGUAGE_SNAPSHOT_START_MARKER,
    LANGUAGE_SNAPSHOT_END_MARKER,
    languageSnapshot,
  );

  await writeFile(README_PATH, updated, "utf8");
  console.log(
    `Updated ${README_PATH} for ${owner}: ${recentRepositories.length} recent repos and ${repositories.length} analyzed repositories.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
