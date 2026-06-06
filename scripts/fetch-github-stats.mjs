#!/usr/bin/env node
/**
 * Fetches GitHub stats for the static website.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node website/scripts/fetch-github-stats.mjs
 *
 * Without a token you get 60 requests/hour (IP-based). With a token you get
 * 5,000 requests/hour. Use a fine-grained PAT with read-only public repo access.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, "..", "data", "github-stats.json");

const GH_API = "https://api.github.com/repos";
const MAIN_REPOS = ["PyLops/pylops", "PyLops/pyproximal", "PyLops/pylops-mpi"];

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "pylops-website-stats",
};
const token = process.env.GITHUB_TOKEN;
if (token) {
  headers.Authorization = `Bearer ${token}`;
}

async function ghGet(url, { allowNotFound = false } = {}) {
  const res = await fetch(url, { headers });
  if (res.status === 404 && allowNotFound) return null;
  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    throw new Error(
      `GitHub API ${res.status} for ${url} (remaining=${remaining}, reset=${reset})`
    );
  }
  return res.json();
}

async function loadCommitsSinceRelease(fullName) {
  const repo = await ghGet(`${GH_API}/${fullName}`);
  const branch = repo?.default_branch || "main";

  const rel = await ghGet(`${GH_API}/${fullName}/releases/latest`, {
    allowNotFound: true,
  });
  if (!rel?.tag_name) {
    return { noRelease: true, branch };
  }

  const tag = rel.tag_name;
  const comparePath = `${encodeURIComponent(tag)}...${encodeURIComponent(branch)}`;
  const compare = await ghGet(`${GH_API}/${fullName}/compare/${comparePath}`);
  const count =
    typeof compare?.ahead_by === "number"
      ? compare.ahead_by
      : typeof compare?.total_commits === "number"
        ? compare.total_commits
        : 0;

  return {
    count,
    tag,
    branch,
    compareUrl: compare?.html_url ?? null,
  };
}

async function loadContributors(fullName) {
  const batch = await ghGet(
    `${GH_API}/${fullName}/contributors?per_page=100&page=1`
  );
  const list = (Array.isArray(batch) ? batch : [])
    .filter((u) => u?.login && u?.avatar_url)
    .map((u) => ({
      login: String(u.login),
      avatar_url: String(u.avatar_url),
      html_url:
        typeof u.html_url === "string"
          ? u.html_url
          : `https://github.com/${u.login}`,
    }));

  return {
    count: list.length,
    countIsLowerBound: Array.isArray(batch) && batch.length === 100,
    list,
  };
}

async function loadOpenPullRequests(fullName) {
  const pulls = await ghGet(
    `${GH_API}/${fullName}/pulls?state=open&sort=updated&direction=desc&per_page=100`
  );
  if (!Array.isArray(pulls)) return [];

  return pulls
    .filter((pr) => pr?.html_url && pr?.title && pr?.updated_at)
    .map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: String(pr.title),
      url: String(pr.html_url),
      updatedAt: String(pr.updated_at),
      repo: fullName,
      author: pr.user?.login ? String(pr.user.login) : "unknown",
    }));
}

const repos = {};
for (const fullName of MAIN_REPOS) {
  const [commits, contributors] = await Promise.all([
    loadCommitsSinceRelease(fullName),
    loadContributors(fullName),
  ]);
  repos[fullName] = { commits, contributors };
}

const pullRequestLists = await Promise.all(
  MAIN_REPOS.map((repo) => loadOpenPullRequests(repo))
);
const pullRequests = pullRequestLists
  .flat()
  .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

const payload = {
  fetchedAt: Date.now(),
  repos,
  pullRequests,
};

await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${OUT_FILE}`);
