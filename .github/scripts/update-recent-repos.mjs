import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const README_PATH = "README.md";
const TROPHY_ASSET_PATH = "assets/github-trophy.svg";
const RECENT_REPOS_START_MARKER = "<!-- RECENT_REPOS:START -->";
const RECENT_REPOS_END_MARKER = "<!-- RECENT_REPOS:END -->";
const LANGUAGE_SNAPSHOT_START_MARKER = "<!-- LANGUAGE_SNAPSHOT:START -->";
const LANGUAGE_SNAPSHOT_END_MARKER = "<!-- LANGUAGE_SNAPSHOT:END -->";
const TROPHY_IMAGE_START_MARKER = "<!-- TROPHY_IMAGE:START -->";
const TROPHY_IMAGE_END_MARKER = "<!-- TROPHY_IMAGE:END -->";

const owner =
  process.env.GITHUB_REPOSITORY_OWNER ??
  process.env.GITHUB_USERNAME ??
  "ravano-2464";
const recentRepoLimit = Number.parseInt(process.env.RECENT_REPO_LIMIT ?? "7", 10);
const topLanguageLimit = Number.parseInt(process.env.TOP_LANGUAGE_LIMIT ?? "6", 10);
const recentActivityWindowDays = Number.parseInt(
  process.env.RECENT_ACTIVITY_WINDOW_DAYS ?? "90",
  10,
);

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

function replaceBlock(
  content,
  startMarker,
  endMarker,
  replacement,
  { strict = false } = {},
) {
  if (!content.includes(startMarker) || !content.includes(endMarker)) {
    if (strict) {
      throw new Error(
        `Markers not found in README. Expected ${startMarker} and ${endMarker}.`,
      );
    }

    return { content, replaced: false };
  }

  const block = `${startMarker}\n${replacement}\n${endMarker}`;
  const pattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`,
    "m",
  );

  return {
    content: content.replace(pattern, block),
    replaced: true,
  };
}

async function readTextIfExists(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeTextIfChanged(path, nextContent) {
  const previousContent = await readTextIfExists(path);
  if (previousContent === nextContent) {
    return false;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, nextContent, "utf8");
  return true;
}

function createAssetVersion(content) {
  return createHash("sha1").update(content).digest("hex").slice(0, 12);
}

function buildGitHubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "readme-profile-updater",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function fetchGitHubJson(url) {
  const response = await fetch(url, { headers: buildGitHubHeaders() });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API failed (${response.status}): ${body}`);
  }

  return response.json();
}

function buildTrophyImageMarkup(cacheBuster) {
  return `<img src="./${TROPHY_ASSET_PATH}?v=${cacheBuster}" width="98%" alt="GitHub Trophy" />`;
}

async function fetchRepositories(username) {
  const repositories = [];
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/users/${username}/repos`);
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("type", "owner");
    url.searchParams.set("page", String(page));

    const data = await fetchGitHubJson(url);
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

async function fetchUserProfile(username) {
  const profile = await fetchGitHubJson(
    new URL(`https://api.github.com/users/${username}`),
  );

  if (!profile || typeof profile !== "object") {
    throw new Error("Unexpected GitHub user profile response.");
  }

  return profile;
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

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCompactNumber(value) {
  return compactNumberFormatter.format(value);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function truncateText(value, maxLength) {
  const text = String(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rankMetric(value, thresholds) {
  if (value >= thresholds[4]) return "SS";
  if (value >= thresholds[3]) return "S";
  if (value >= thresholds[2]) return "AA";
  if (value >= thresholds[1]) return "A";
  if (value >= thresholds[0]) return "B";
  return "C";
}

function metricProgress(value, thresholds) {
  const ceiling = thresholds[thresholds.length - 1] ?? 1;
  return clamp(value / ceiling, 0, 1);
}

function nextThreshold(value, thresholds) {
  return thresholds.find((threshold) => value < threshold) ?? null;
}

function nextRank(value, thresholds) {
  const order = ["B", "A", "AA", "S", "SS"];
  const index = thresholds.findIndex((threshold) => value < threshold);
  return index === -1 ? null : order[index];
}

function metricStatus(value, thresholds) {
  const upcomingThreshold = nextThreshold(value, thresholds);
  const upcomingRank = nextRank(value, thresholds);

  if (upcomingThreshold === null || upcomingRank === null) {
    return "MAX TIER UNLOCKED";
  }

  return `${upcomingThreshold - value} TO ${upcomingRank}`;
}

function rankPalette(rank) {
  switch (rank) {
    case "SS":
      return { fill: "#39ff14", text: "#000000", glow: "#39ff14" };
    case "S":
      return { fill: "#00ff41", text: "#000000", glow: "#00ff41" };
    case "AA":
      return { fill: "#10b981", text: "#ffffff", glow: "#10b981" };
    case "A":
      return { fill: "#059669", text: "#ffffff", glow: "#059669" };
    case "B":
      return { fill: "#047857", text: "#ffffff", glow: "#047857" };
    default:
      return { fill: "#1f2937", text: "#9ca3af", glow: "#1f2937" };
  }
}

function buildTrophyMetrics(user, repositories) {
  const totalStars = repositories.reduce(
    (sum, repo) => sum + (repo.stargazers_count ?? 0),
    0,
  );
  const totalForks = repositories.reduce(
    (sum, repo) => sum + (repo.forks_count ?? 0),
    0,
  );
  const languageCount = new Set(
    repositories.map((repo) => repo.language).filter(Boolean),
  ).size;
  const recentWindowStart = Date.now() - recentActivityWindowDays * 24 * 60 * 60 * 1000;
  const activeRecent = repositories.filter((repo) => {
    const lastPush = Date.parse(repo.pushed_at ?? repo.updated_at ?? 0);
    return Number.isFinite(lastPush) && lastPush >= recentWindowStart;
  }).length;
  const topRepository = repositories.reduce(
    (best, repo) => {
      if (!best || (repo.stargazers_count ?? 0) > (best.stargazers_count ?? 0)) {
        return repo;
      }

      return best;
    },
    null,
  );

  const topRepoName = topRepository?.name ? truncateText(topRepository.name, 18) : "";

  return [
    {
      label: "Followers",
      value: user.followers ?? 0,
      displayValue: formatCompactNumber(user.followers ?? 0),
      hint: "People following the profile",
      thresholds: [5, 10, 25, 50, 100],
      accent: "#00ff41",
      icon: "followers",
    },
    {
      label: "Repositories",
      value: repositories.length,
      displayValue: formatCompactNumber(repositories.length),
      hint: "Active public repositories",
      thresholds: [5, 15, 30, 50, 75],
      accent: "#39ff14",
      icon: "repositories",
    },
    {
      label: "Total Stars",
      value: totalStars,
      displayValue: formatCompactNumber(totalStars),
      hint: "Stars collected on projects",
      thresholds: [5, 15, 30, 75, 150],
      accent: "#10b981",
      icon: "stars",
    },
    {
      label: "Total Forks",
      value: totalForks,
      displayValue: formatCompactNumber(totalForks),
      hint: "Forks of public repositories",
      thresholds: [1, 5, 10, 25, 50],
      accent: "#059669",
      icon: "forks",
    },
    {
      label: "Languages",
      value: languageCount,
      displayValue: formatCompactNumber(languageCount),
      hint: "Primary languages shipped",
      thresholds: [2, 4, 6, 8, 10],
      accent: "#34d399",
      icon: "languages",
    },
    {
      label: `Active ${recentActivityWindowDays}d`,
      value: activeRecent,
      displayValue: formatCompactNumber(activeRecent),
      hint: `Repos updated in last ${recentActivityWindowDays} days`,
      thresholds: [1, 3, 5, 8, 12],
      accent: "#a7f3d0",
      icon: "activity",
    },
    {
      label: "Top Repo Star",
      value: topRepository?.stargazers_count ?? 0,
      displayValue: formatCompactNumber(topRepository?.stargazers_count ?? 0),
      hint: topRepoName
        ? `Most-starred: ${topRepoName}`
        : "No starred repos found",
      thresholds: [1, 5, 10, 25, 50],
      accent: "#00ff88",
      icon: "crown",
    },
  ].map((metric) => ({
    ...metric,
    rank: rankMetric(metric.value, metric.thresholds),
    progress: metricProgress(metric.value, metric.thresholds),
    status: metricStatus(metric.value, metric.thresholds),
  }));
}

function buildMetricIcon(icon, accent) {
  switch (icon) {
    case "followers":
      return `
        <g fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="14" cy="15" r="4.5" />
          <circle cx="27" cy="17" r="3.5" />
          <path d="M7.5 29c1.4-4.4 5.4-6.8 10.1-6.8 4.7 0 8.4 2.2 9.6 6.8" />
          <path d="M23 29c1.1-2.9 3.6-4.8 6.9-4.8 1.8 0 3.5.6 4.9 1.8" />
        </g>`;
    case "repositories":
      return `
        <g fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 14.5h9.2l3.4 3.9H31a3.5 3.5 0 0 1 3.5 3.5v8.8A3.5 3.5 0 0 1 31 34.2H9A3.5 3.5 0 0 1 5.5 30.7V18a3.5 3.5 0 0 1 3.5-3.5z" />
          <path d="M5.8 21h28.4" />
        </g>`;
    case "stars":
      return `
        <polygon points="20,5 24.7,14.4 35,15.9 27.5,23.1 29.3,33.2 20,28.3 10.7,33.2 12.5,23.1 5,15.9 15.3,14.4" fill="${accent}" />`;
    case "forks":
      return `
        <g fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="10" r="3.2" />
          <circle cx="28" cy="18" r="3.2" />
          <circle cx="12" cy="30" r="3.2" />
          <path d="M12 13.2v13.6" />
          <path d="M15.3 11.5h6.2a6.5 6.5 0 0 1 6.5 6.5" />
        </g>`;
    case "languages":
      return `
        <g fill="none" stroke="${accent}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M13 12L6 20l7 8" />
          <path d="M27 12l7 8-7 8" />
          <path d="M22 9l-4 22" />
        </g>`;
    case "activity":
      return `
        <g fill="none" stroke="${accent}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5.5 23h7l3.1-8.2 5.1 15 4.2-10.2h9.6" />
        </g>`;
    case "crown":
      return `
        <g fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 28.5L9.3 13l10.2 8 7.2-11 7.2 11 10.1-8 2.8 15.5H6.5z" />
          <path d="M10.5 32.5h31" />
        </g>`;
    default:
      return `
        <polygon points="20,5 24.7,14.4 35,15.9 27.5,23.1 29.3,33.2 20,28.3 10.7,33.2 12.5,23.1 5,15.9 15.3,14.4" fill="${accent}" />`;
  }
}

function buildCard(metric, x, y, index, width, height) {
  const cardPadding = 22;
  const hintY = 128;
  const barX = cardPadding;
  const barY = height - 42;
  const barWidth = width - (cardPadding * 2);
  const barFillWidth = Math.max(10, Math.round(barWidth * metric.progress));
  const statusY = height - 18;
  const rankStyle = rankPalette(metric.rank);

  return `
    <g transform="translate(${x} ${y})">
      <!-- Card background with glow drop-shadow -->
      <rect x="0" y="0" width="${width}" height="${height}" rx="16" fill="url(#card-bg-${index})" stroke="${metric.accent}" stroke-opacity="0.25" stroke-width="1.2" filter="url(#card-shadow)" />
      
      <!-- Icon Container -->
      <circle cx="34" cy="34" r="18" fill="${metric.accent}" fill-opacity="0.16" />
      <circle cx="34" cy="34" r="17.2" fill="none" stroke="${metric.accent}" stroke-opacity="0.35" />
      <g transform="translate(14 14)">
        ${buildMetricIcon(metric.icon, metric.accent)}
      </g>
      
      <!-- Rank Pill Badge -->
      <rect x="${width - 62}" y="20" width="44" height="24" rx="12" fill="${rankStyle.fill}" />
      <text x="${width - 40}" y="35.5" text-anchor="middle" font-size="11" font-weight="800" fill="${rankStyle.text}" letter-spacing="0.5">${escapeXml(metric.rank)}</text>
      
      <!-- Content -->
      <text x="${cardPadding}" y="74" font-size="11" font-weight="700" fill="#A7F3D0" letter-spacing="0.8">${escapeXml(metric.label.toUpperCase())}</text>
      <text x="${cardPadding}" y="112" font-size="32" font-weight="800" fill="#F8FAFC">${escapeXml(metric.displayValue)}</text>
      <text x="${cardPadding}" y="${hintY}" font-size="11" fill="#94A3B8">${escapeXml(truncateText(metric.hint, 38))}</text>
      
      <!-- Progress Bar -->
      <rect x="${barX}" y="${barY}" width="${barWidth}" height="7" rx="3.5" fill="#010601" fill-opacity="0.9" stroke="${metric.accent}" stroke-opacity="0.08" />
      <rect x="${barX}" y="${barY}" width="${barFillWidth}" height="7" rx="3.5" fill="${metric.accent}" />
      
      <!-- Status Text -->
      <text x="${cardPadding}" y="${statusY}" font-size="10" font-weight="800" fill="${rankStyle.fill}" opacity="0.9" letter-spacing="0.5">${escapeXml(metric.status)}</text>
    </g>`;
}

function getTrophyRowSizes(count) {
  if (count <= 3) return [count];
  if (count === 4) return [2, 2];
  if (count === 5) return [2, 3];
  if (count === 6) return [3, 3];
  if (count === 7) return [2, 3, 2];

  const firstRow = Math.ceil(count / 3);
  const remaining = count - firstRow;
  const secondRow = Math.ceil(remaining / 2);
  const thirdRow = remaining - secondRow;
  return [firstRow, secondRow, thirdRow].filter((size) => size > 0);
}

function buildTrophySvg(username, user, repositories) {
  const metrics = buildTrophyMetrics(user, repositories);
  const width = 900;
  const cardWidth = 260;
  const cardHeight = 185;
  const gap = 26;
  const rowGap = 26;
  const contentTop = 140;
  const footerSpace = 68;
  const rowSizes = getTrophyRowSizes(metrics.length);
  const totalCardHeight =
    rowSizes.length * cardHeight + (rowSizes.length - 1) * rowGap;
  const height = contentTop + totalCardHeight + footerSpace;
  const gradients = metrics
    .map(
      (metric, index) => `
      <linearGradient id="card-bg-${index}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#051205" />
        <stop offset="100%" stop-color="${metric.accent}" stop-opacity="0.16" />
      </linearGradient>`,
    )
    .join("");
  const cards = [];
  let metricIndex = 0;

  rowSizes.forEach((rowSize, rowIndex) => {
    const rowWidth = rowSize * cardWidth + (rowSize - 1) * gap;
    const rowX = Math.round((width - rowWidth) / 2);
    const rowY = contentTop + rowIndex * (cardHeight + rowGap);

    for (let columnIndex = 0; columnIndex < rowSize; columnIndex += 1) {
      const metric = metrics[metricIndex];
      if (!metric) {
        break;
      }

      const x = rowX + columnIndex * (cardWidth + gap);
      cards.push(buildCard(metric, x, rowY, metricIndex, cardWidth, cardHeight));
      metricIndex += 1;
    }
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} GitHub trophy board</title>
  <desc id="desc">Auto-generated GitHub achievement cards based on public profile metrics.</desc>
  <defs>
    <style>
      .glow-circle-1 {
        animation: pulse-1 8s ease-in-out infinite;
      }
      .glow-circle-2 {
        animation: pulse-2 10s ease-in-out infinite;
      }
      .glow-circle-3 {
        animation: pulse-3 7s ease-in-out infinite;
      }
      @keyframes pulse-1 {
        0%, 100% { fill-opacity: 0.03; }
        50% { fill-opacity: 0.08; }
      }
      @keyframes pulse-2 {
        0%, 100% { fill-opacity: 0.04; }
        50% { fill-opacity: 0.09; }
      }
      @keyframes pulse-3 {
        0%, 100% { fill-opacity: 0.02; }
        50% { fill-opacity: 0.07; }
      }
    </style>
    <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.6" />
    </filter>
    <linearGradient id="board-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#020802" />
      <stop offset="52%" stop-color="#0b1a0b" />
      <stop offset="100%" stop-color="#020802" />
    </linearGradient>
    <linearGradient id="header-glow" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00FF41" />
      <stop offset="50%" stop-color="#10B981" />
      <stop offset="100%" stop-color="#39FF14" />
    </linearGradient>
    <linearGradient id="trophy-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDE68A" />
      <stop offset="100%" stop-color="#F59E0B" />
    </linearGradient>
    ${gradients}
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" rx="34" fill="url(#board-bg)" />
  <circle cx="120" cy="36" r="110" fill="#00FF41" fill-opacity="0.05" class="glow-circle-1" />
  <circle cx="804" cy="${height - 78}" r="132" fill="#10B981" fill-opacity="0.05" class="glow-circle-2" />
  <circle cx="748" cy="58" r="90" fill="#39FF14" fill-opacity="0.04" class="glow-circle-3" />
  <rect x="28" y="28" width="${width - 56}" height="${height - 56}" rx="28" fill="none" stroke="#00FF41" stroke-opacity="0.16" />
  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">
    <text x="42" y="56" font-size="14" font-weight="700" fill="#00FF41" letter-spacing="1.4">AUTO-UPDATED LOCAL TROPHIES</text>
    <text x="42" y="88" font-size="30" font-weight="800" fill="#F8FAFC">GitHub Trophy Vault</text>
    <text x="42" y="108" font-size="13" fill="#00FF41" opacity="0.6">@${escapeXml(username)} | sourced from public GitHub API</text>
    <rect x="42" y="120" width="250" height="4" rx="2" fill="url(#header-glow)" fill-opacity="0.92" />
    <g transform="translate(800 70)">
      <path d="M-22 -18h44v11c0 17-10 31-22 36-12-5-22-19-22-36v-11z" fill="url(#trophy-gold)" />
      <path d="M-34 -12c0 10 5 18 12 21" fill="none" stroke="#FCD34D" stroke-width="5" stroke-linecap="round" />
      <path d="M34 -12c0 10-5 18-12 21" fill="none" stroke="#FCD34D" stroke-width="5" stroke-linecap="round" />
      <rect x="-10" y="20" width="20" height="12" rx="3" fill="#F59E0B" />
      <rect x="-20" y="30" width="40" height="10" rx="4" fill="#B45309" />
    </g>
    ${cards.join("")}
    <text x="42" y="${height - 40}" font-size="12" fill="#64748B">Self-healing trophy asset. No external trophy dependency required.</text>
  </g>
</svg>
`;
}

async function main() {
  const user = await fetchUserProfile(owner);
  const repositories = await fetchRepositories(owner);
  const recentRepositories = repositories.slice(0, recentRepoLimit);
  const recentTable = buildRecentReposTable(recentRepositories);
  const languageSnapshot = buildLanguageSnapshot(repositories);

  const readme = await readFile(README_PATH, "utf8");
  let updated = readme;
  let readmeChanged = false;

  const recentBlock = replaceBlock(
    readme,
    RECENT_REPOS_START_MARKER,
    RECENT_REPOS_END_MARKER,
    recentTable,
  );
  if (recentBlock.replaced) {
    updated = recentBlock.content;
    readmeChanged = true;
  } else {
    console.warn(
      `Skipping recent repository update because ${RECENT_REPOS_START_MARKER} markers were not found.`,
    );
  }

  const languageBlock = replaceBlock(
    updated,
    LANGUAGE_SNAPSHOT_START_MARKER,
    LANGUAGE_SNAPSHOT_END_MARKER,
    languageSnapshot,
  );
  if (languageBlock.replaced) {
    updated = languageBlock.content;
    readmeChanged = true;
  } else {
    console.warn(
      `Skipping language snapshot update because ${LANGUAGE_SNAPSHOT_START_MARKER} markers were not found.`,
    );
  }

  let trophyUpdated = false;
  const trophySvg = buildTrophySvg(owner, user, repositories);
  const trophyVersion = createAssetVersion(trophySvg);
  trophyUpdated = await writeTextIfChanged(TROPHY_ASSET_PATH, trophySvg);

  const trophyBlock = replaceBlock(
    updated,
    TROPHY_IMAGE_START_MARKER,
    TROPHY_IMAGE_END_MARKER,
    buildTrophyImageMarkup(trophyVersion),
  );

  if (trophyBlock.replaced) {
    if (trophyBlock.content !== updated) {
      updated = trophyBlock.content;
      readmeChanged = true;
    }
  } else {
    console.warn(
      `Skipping trophy README refresh because ${TROPHY_IMAGE_START_MARKER} markers were not found.`,
    );
  }

  if (readmeChanged) {
    await writeFile(README_PATH, updated, "utf8");
  }
  console.log(
    `Profile refresh complete for ${owner}: ${recentRepositories.length} recent repos, ${repositories.length} analyzed repositories, trophy ${trophyUpdated ? "updated" : "unchanged"}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
