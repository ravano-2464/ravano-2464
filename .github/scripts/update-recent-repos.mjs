import { readFile, writeFile } from "node:fs/promises";

const README_PATH = "README.md";
const START_MARKER = "<!-- RECENT_REPOS:START -->";
const END_MARKER = "<!-- RECENT_REPOS:END -->";

const owner =
  process.env.GITHUB_REPOSITORY_OWNER ??
  process.env.GITHUB_USERNAME ??
  "ravano-2464";
const limit = Number.parseInt(process.env.RECENT_REPO_LIMIT ?? "7", 10);

function toDateString(value) {
  if (!value) return "-";
  const date = new Date(value);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function buildTable(repositories) {
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

function updateReadme(readmeContent, table) {
  if (!readmeContent.includes(START_MARKER) || !readmeContent.includes(END_MARKER)) {
    throw new Error(
      `Markers not found in README. Expected ${START_MARKER} and ${END_MARKER}.`,
    );
  }

  const block = `${START_MARKER}\n${table}\n${END_MARKER}`;
  const pattern = new RegExp(
    `${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`,
    "m",
  );

  return readmeContent.replace(pattern, block);
}

async function fetchRepositories(username) {
  const url = new URL(`https://api.github.com/users/${username}/repos`);
  url.searchParams.set("sort", "updated");
  url.searchParams.set("direction", "desc");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("type", "owner");

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "recent-repos-updater",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Unexpected GitHub API response.");
  }

  return data
    .filter((repo) => !repo.fork && !repo.archived && repo.name !== username)
    .sort((a, b) => Date.parse(b.pushed_at ?? b.updated_at ?? 0) - Date.parse(a.pushed_at ?? a.updated_at ?? 0))
    .slice(0, limit);
}

async function main() {
  const repositories = await fetchRepositories(owner);
  const table = buildTable(repositories);
  const readme = await readFile(README_PATH, "utf8");
  const updated = updateReadme(readme, table);
  await writeFile(README_PATH, updated, "utf8");
  console.log(`Updated ${README_PATH} with ${repositories.length} repositories for ${owner}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
