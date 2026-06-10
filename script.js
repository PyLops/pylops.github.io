const revealNodes = document.querySelectorAll(".reveal");
const themeToggleButton = document.getElementById("theme-toggle");
const THEME_STORAGE_KEY = "pylops-website-theme";
const rootElement = document.documentElement;

function applyTheme(theme) {
  const isLight = theme === "light";
  rootElement.classList.toggle("light-theme", isLight);
  if (!themeToggleButton) return;
  themeToggleButton.setAttribute(
    "aria-label",
    isLight ? "Switch to dark theme" : "Switch to light theme"
  );
}

if (themeToggleButton) {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(storedTheme === "light" ? "light" : "dark");

  themeToggleButton.addEventListener("click", () => {
    const nextTheme = rootElement.classList.contains("light-theme")
      ? "dark"
      : "light";
    applyTheme(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  });
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    },
    {
      threshold: 0.14,
      rootMargin: "0px 0px -8% 0px",
    }
  );

  revealNodes.forEach((node) => observer.observe(node));
} else {
  revealNodes.forEach((node) => node.classList.add("is-visible"));
}

const GH_API = "https://api.github.com/repos";
const ghHeaders = { Accept: "application/vnd.github+json" };
const MAIN_REPOS = ["PyLops/pylops", "PyLops/pyproximal", "PyLops/pylops-mpi"];
const TOP_ACTIVE_PR_CARDS = 4;
const GH_CACHE_STORAGE_KEY = "pylops-gh-api-cache-v1";
const GH_CACHE_TTL_MS = 30 * 60 * 1000;
const GH_CACHE_STALE_MS = 24 * 60 * 60 * 1000;
const GH_STATIC_STATS_URL = "./data/github-stats.json";
const BADGE_CACHE_STORAGE_KEY = "pylops-shields-badge-cache-v1";
const BADGE_CACHE_TTL_MS = GH_CACHE_TTL_MS;
const BADGE_CACHE_STALE_MS = GH_CACHE_STALE_MS;
const ghRepoFetches = new Map();

function readGhCacheStore() {
  try {
    const raw = localStorage.getItem(GH_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeGhCacheStore(store) {
  try {
    localStorage.setItem(GH_CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded or private mode */
  }
}

function getGhCacheEntry(url) {
  const store = readGhCacheStore();
  const entry = store[url];
  if (!entry || typeof entry.fetchedAt !== "number") return null;
  const age = Date.now() - entry.fetchedAt;
  return {
    data: entry.data,
    status: entry.status,
    age,
    fresh: age < GH_CACHE_TTL_MS,
    usable: age < GH_CACHE_STALE_MS,
  };
}

function setGhCacheEntry(url, data, status) {
  const store = readGhCacheStore();
  store[url] = { fetchedAt: Date.now(), data, status };
  writeGhCacheStore(store);
}

function isGhRateLimited(res) {
  if (res.status !== 403) return false;
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  return remaining === "0" || Boolean(reset);
}

async function ghFetch(url, { allowNotFound = false } = {}) {
  const cached = getGhCacheEntry(url);
  if (cached?.fresh) {
    return { data: cached.data, status: cached.status, fromCache: true, stale: false };
  }

  const res = await fetch(url, { headers: ghHeaders });
  if (res.status === 404 && allowNotFound) {
    setGhCacheEntry(url, null, 404);
    return { data: null, status: 404, fromCache: false, stale: false };
  }

  if (!res.ok) {
    if (isGhRateLimited(res) && cached?.usable) {
      return { data: cached.data, status: cached.status, fromCache: true, stale: true };
    }
    throw new Error(`gh:${res.status}:${url}`);
  }

  const data = await res.json();
  setGhCacheEntry(url, data, res.status);
  return { data, status: res.status, fromCache: false, stale: false };
}

async function fetchGithubRepo(fullName) {
  if (!ghRepoFetches.has(fullName)) {
    ghRepoFetches.set(fullName, ghFetch(`${GH_API}/${fullName}`));
  }
  const result = await ghRepoFetches.get(fullName);
  if (result.stale) markGhStaleUsage();
  return result.data;
}

let ghServedStaleCache = false;

function markGhStaleUsage() {
  ghServedStaleCache = true;
}

function ghStaleNotice() {
  return ghServedStaleCache
    ? " Showing cached GitHub data (API rate limit reached)."
    : "";
}

function showGhCacheNotice() {
  if (!ghServedStaleCache) return;
  const hint = document.querySelector(".commit-bars-hint");
  if (!hint || hint.dataset.staleNotice === "1") return;
  hint.dataset.staleNotice = "1";
  hint.append(document.createTextNode(ghStaleNotice()));
}

function readBadgeCacheStore() {
  try {
    const raw = localStorage.getItem(BADGE_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeBadgeCacheStore(store) {
  try {
    localStorage.setItem(BADGE_CACHE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded or private mode */
  }
}

function getBadgeCacheEntry(url) {
  const store = readBadgeCacheStore();
  const entry = store[url];
  if (!entry || typeof entry.fetchedAt !== "number") return null;
  const age = Date.now() - entry.fetchedAt;
  return {
    svg: entry.svg,
    fresh: age < BADGE_CACHE_TTL_MS,
    usable: age < BADGE_CACHE_STALE_MS,
  };
}

function setBadgeCacheEntry(url, svg) {
  const store = readBadgeCacheStore();
  store[url] = { fetchedAt: Date.now(), svg };
  writeBadgeCacheStore(store);
}

function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvgText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatBadgeCount(value) {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count)) return "?";
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(count / 1000)}k`;
}

function badgeTextWidth(text) {
  return Math.max(34, Math.round(String(text).length * 6.5 + 10));
}

function createFlatBadgeSvg(label, message, color = "#4c1") {
  const safeLabel = escapeSvgText(label);
  const safeMessage = escapeSvgText(message);
  const labelWidth = badgeTextWidth(safeLabel);
  const messageWidth = badgeTextWidth(safeMessage);
  const width = labelWidth + messageWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${safeLabel}: ${safeMessage}"><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${labelWidth}" height="20" fill="#555"/><rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${color}"/><rect width="${width}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110"><text aria-hidden="true" x="${labelWidth * 5}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}">${safeLabel}</text><text x="${labelWidth * 5}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 10) * 10}">${safeLabel}</text><text aria-hidden="true" x="${(labelWidth + messageWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(messageWidth - 10) * 10}">${safeMessage}</text><text x="${(labelWidth + messageWidth / 2) * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(messageWidth - 10) * 10}">${safeMessage}</text></g></svg>`;
}

function parseGithubBadge(src) {
  const match = String(src).match(
    /img\.shields\.io\/github\/(stars|forks)\/([^/?]+)\/([^?]+)/
  );
  if (!match) return null;

  const [, metric, owner, repo] = match;
  return {
    metric,
    fullName: `${owner}/${decodeURIComponent(repo)}`,
    label: metric === "stars" ? "Stars" : "Forks",
  };
}

function fallbackBadgeForSrc(src, message = "...") {
  const badgeSrc = String(src);
  if (badgeSrc.includes("img.shields.io/pypi/dm/")) {
    return createFlatBadgeSvg("Downloads", message, "#007ec6");
  }
  if (badgeSrc.includes("img.shields.io/conda/dn/")) {
    return createFlatBadgeSvg("Downloads", message, "#44a833");
  }
  return null;
}

async function renderGithubBadge(img, badge) {
  const repo = await fetchGithubRepo(badge.fullName);
  const value =
    badge.metric === "stars" ? repo?.stargazers_count : repo?.forks_count;
  const svg = createFlatBadgeSvg(badge.label, formatBadgeCount(value));
  img.src = svgToDataUrl(svg);
  setBadgeCacheEntry(img.dataset.badgeSrc, svg);
}

async function applyCachedBadge(img) {
  const originalSrc =
    img.dataset.badgeSrc || img.getAttribute("src") || img.currentSrc;
  if (!originalSrc) return;
  img.dataset.badgeSrc = originalSrc;

  const cached = getBadgeCacheEntry(originalSrc);
  if (cached?.fresh && cached.svg) {
    img.src = svgToDataUrl(cached.svg);
    return;
  }

  const githubBadge = parseGithubBadge(originalSrc);
  if (githubBadge) {
    try {
      await renderGithubBadge(img, githubBadge);
      return;
    } catch {
      if (cached?.usable && cached.svg) {
        img.src = svgToDataUrl(cached.svg);
        return;
      }
    }
  }

  const fallbackSvg = fallbackBadgeForSrc(originalSrc);
  if (fallbackSvg) {
    img.src = svgToDataUrl(fallbackSvg);
  }

  try {
    const res = await fetch(originalSrc, {
      cache: "no-cache",
      headers: { Accept: "image/svg+xml" },
    });
    if (!res.ok) throw new Error(`badge:${res.status}`);

    const svg = await res.text();
    if (!svg.includes("<svg")) throw new Error("badge:invalid-svg");

    setBadgeCacheEntry(originalSrc, svg);
    img.src = svgToDataUrl(svg);
  } catch {
    if (cached?.usable && cached.svg) {
      img.src = svgToDataUrl(cached.svg);
    } else {
      const unavailableSvg = fallbackBadgeForSrc(originalSrc, "?");
      if (unavailableSvg) img.src = svgToDataUrl(unavailableSvg);
    }
  }
}

async function initBadgeCache() {
  const badges = Array.from(
    document.querySelectorAll(
      '.cta-badges img[data-badge-src], .cta-badges img[src^="https://img.shields.io/"]'
    )
  );
  if (!badges.length) return;
  await Promise.allSettled(badges.map((badge) => applyCachedBadge(badge)));
}

const COMMIT_BATTERY_MAX = 100;
const COMMIT_LEVEL_CLASSES = [
  "battery-level-good",
  "battery-level-warn",
  "battery-level-critical",
];

function commitBatteryLevel(count) {
  if (count < 50) return "battery-level-good";
  if (count < 100) return "battery-level-warn";
  return "battery-level-critical";
}

function commitBatteryFillPct(count) {
  const n = typeof count === "number" ? count : 0;
  return Math.max(0, Math.min(100, (n / COMMIT_BATTERY_MAX) * 100));
}

function setCommitBar(el, { count, tag, branch, compareUrl, error, noRelease }) {
  const countEl = el.querySelector('[data-role="count"]');
  const fillEl = el.querySelector('[data-role="fill"]');
  const batteryEl = el.querySelector(".commit-battery");
  const metaEl = el.querySelector('[data-role="meta"]');

  el.setAttribute("aria-busy", "false");

  if (batteryEl) {
    batteryEl.classList.remove(...COMMIT_LEVEL_CLASSES);
  }
  if (countEl) {
    countEl.classList.remove(...COMMIT_LEVEL_CLASSES);
  }

  if (error) {
    if (countEl) countEl.textContent = "—";
    if (fillEl) fillEl.style.width = "0%";
    if (batteryEl) {
      batteryEl.setAttribute("aria-valuenow", "0");
      batteryEl.setAttribute("aria-valuetext", "Unable to load");
    }
    if (metaEl) {
      metaEl.textContent =
        "Could not load stats (network or GitHub API rate limit).";
    }
    return;
  }

  if (noRelease) {
    if (countEl) countEl.textContent = "—";
    if (fillEl) fillEl.style.width = "0%";
    if (batteryEl) {
      batteryEl.setAttribute("aria-valuenow", "0");
      batteryEl.setAttribute("aria-valuetext", "No release");
    }
    if (metaEl) {
      metaEl.textContent =
        "No published GitHub release yet; compare is not available.";
    }
    return;
  }

  const n = typeof count === "number" ? count : 0;
  const width = commitBatteryFillPct(n);
  const level = commitBatteryLevel(n);

  if (countEl) {
    countEl.textContent = String(n);
    countEl.classList.add(level);
  }
  if (fillEl) fillEl.style.width = `${width}%`;
  if (batteryEl) {
    batteryEl.classList.add(level);
    batteryEl.setAttribute("aria-valuenow", String(Math.round(width)));
    batteryEl.setAttribute(
      "aria-valuetext",
      `${n} commits since ${tag ?? "release"}`
    );
  }

  if (metaEl) {
    const safeTag = tag ? String(tag) : "";
    const safeBranch = branch ? String(branch) : "main";
    metaEl.textContent = "";
    if (safeTag) {
      const last = document.createTextNode(`Latest release: ${safeTag} · `);
      metaEl.appendChild(last);
    }
    if (compareUrl) {
      const a = document.createElement("a");
      a.href = compareUrl;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = "View diff on GitHub";
      metaEl.appendChild(a);
      metaEl.appendChild(document.createTextNode(` (${safeBranch}).`));
    } else {
      metaEl.appendChild(
        document.createTextNode(`Default branch: ${safeBranch}.`)
      );
    }
  }
}

async function loadCommitsSinceRelease(fullName) {
  const repo = await fetchGithubRepo(fullName);
  const branch = repo?.default_branch || "main";

  const releaseUrl = `${GH_API}/${fullName}/releases/latest`;
  const relResult = await ghFetch(releaseUrl, { allowNotFound: true });
  if (relResult.stale) markGhStaleUsage();
  if (relResult.status === 404) {
    return { noRelease: true, branch };
  }
  const rel = relResult.data;
  const tag = rel?.tag_name;
  if (!tag) {
    return { noRelease: true, branch };
  }

  const comparePath = `${encodeURIComponent(tag)}...${encodeURIComponent(branch)}`;
  const compareUrl = `${GH_API}/${fullName}/compare/${comparePath}`;
  const compareResult = await ghFetch(compareUrl);
  if (compareResult.stale) markGhStaleUsage();
  const compare = compareResult.data;
  const count =
    typeof compare?.ahead_by === "number"
      ? compare.ahead_by
      : typeof compare?.total_commits === "number"
        ? compare.total_commits
        : 0;
  const compareHtmlUrl =
    typeof compare?.html_url === "string" ? compare.html_url : null;

  return { count, tag, branch, compareUrl: compareHtmlUrl };
}

const MAX_AVATAR_TILES = 32;

async function fetchContributors(fullName) {
  const endpoint = `${GH_API}/${fullName}/contributors?per_page=100&page=1`;
  const result = await ghFetch(endpoint);
  if (result.stale) markGhStaleUsage();
  const batch = Array.isArray(result.data) ? result.data : [];
  const contributors = [];

  for (const u of batch) {
    if (u && u.login && u.avatar_url) {
      contributors.push({
        login: String(u.login),
        avatar_url: String(u.avatar_url),
        html_url:
          typeof u.html_url === "string"
            ? u.html_url
            : `https://github.com/${u.login}`,
      });
    }
  }

  return {
    count: contributors.length,
    countIsLowerBound: batch.length === 100,
    contributors,
  };
}

function setContributorCard(
  el,
  { count, countIsLowerBound, contributors, contributorsUrl, error }
) {
  const countEl = el.querySelector('[data-role="contributor-count"]');
  const avatarsEl = el.querySelector('[data-role="contributor-avatars"]');
  const metaEl = el.querySelector('[data-role="contributor-meta"]');

  el.setAttribute("aria-busy", "false");

  if (error) {
    if (countEl) countEl.textContent = "—";
    if (avatarsEl) avatarsEl.innerHTML = "";
    if (metaEl) {
      metaEl.textContent =
        "Could not load contributors (network or GitHub API rate limit).";
    }
    return;
  }

  if (countEl) {
    countEl.textContent =
      countIsLowerBound && typeof count === "number" ? `${count}+` : String(count);
  }

  if (avatarsEl) {
    avatarsEl.innerHTML = "";
    avatarsEl.setAttribute("role", "list");

    const list = Array.isArray(contributors) ? contributors : [];
    const shown = list.slice(0, MAX_AVATAR_TILES);

    shown.forEach((c) => {
      const item = document.createElement("span");
      item.setAttribute("role", "listitem");
      item.className = "contributor-avatar-item";

      const a = document.createElement("a");
      a.className = "contributor-avatar";
      a.href = c.html_url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.title = c.login;
      a.setAttribute("aria-label", `${c.login} on GitHub`);

      const img = document.createElement("img");
      img.src = c.avatar_url;
      img.alt = "";
      img.width = 64;
      img.height = 64;
      img.loading = "lazy";
      img.decoding = "async";

      a.appendChild(img);
      item.appendChild(a);
      avatarsEl.appendChild(item);
    });

    if (list.length > MAX_AVATAR_TILES) {
      const more = document.createElement("span");
      more.className = "contributor-more";
      more.setAttribute("role", "listitem");
      more.textContent = `+${list.length - MAX_AVATAR_TILES} more`;
      more.title = "Additional contributors on GitHub";
      avatarsEl.appendChild(more);
    }
  }

  if (metaEl) {
    metaEl.textContent = "";
    if (contributorsUrl) {
      const a = document.createElement("a");
      a.href = contributorsUrl;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = "View all contributors on GitHub";
      metaEl.appendChild(a);
    }
  }
}

function formatRelativeUpdated(isoDate) {
  const time = Date.parse(String(isoDate || ""));
  if (Number.isNaN(time)) return "Updated recently";

  const deltaMs = Date.now() - time;
  const minutes = Math.max(1, Math.round(deltaMs / 60000));

  if (minutes < 60) {
    return `Updated ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `Updated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.round(hours / 24);
  return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
}

async function fetchOpenPullRequests(fullName) {
  const endpoint = `${GH_API}/${fullName}/pulls?state=open&sort=updated&direction=desc&per_page=100`;
  const result = await ghFetch(endpoint);
  if (result.stale) markGhStaleUsage();
  const pulls = result.data;
  if (!Array.isArray(pulls)) return [];

  return pulls
    .filter((pr) => pr && pr.html_url && pr.title && pr.updated_at)
    .map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: String(pr.title),
      url: String(pr.html_url),
      updatedAt: String(pr.updated_at),
      repo: fullName,
      author: pr.user && pr.user.login ? String(pr.user.login) : "unknown",
    }));
}

function renderOpenPullRequests(items) {
  const feed = document.querySelector("[data-pr-feed]");
  const status = document.querySelector("[data-pr-status]");
  const cards = document.querySelector("[data-pr-cards]");
  const listWrap = document.querySelector("[data-pr-list-wrap]");
  const list = document.querySelector("[data-pr-list]");
  if (!feed || !status || !cards || !listWrap || !list) return;

  feed.setAttribute("aria-busy", "false");
  cards.innerHTML = "";
  list.innerHTML = "";

  if (!Array.isArray(items) || !items.length) {
    status.textContent = "No open pull requests right now.";
    listWrap.hidden = true;
    return;
  }

  status.textContent = `${items.length} open pull request${items.length === 1 ? "" : "s"} across the three repositories.${ghStaleNotice()}`;

  const top = items.slice(0, TOP_ACTIVE_PR_CARDS);
  const rest = items.slice(TOP_ACTIVE_PR_CARDS);

  top.forEach((pr) => {
    const article = document.createElement("article");
    article.className = "activity-card";

    const repo = document.createElement("p");
    repo.className = "activity-card-repo";
    repo.textContent = pr.repo;

    const title = document.createElement("h3");
    title.className = "activity-card-title";
    const link = document.createElement("a");
    link.href = pr.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `#${pr.number} ${pr.title}`;
    link.setAttribute("aria-label", `Open PR ${pr.number} in ${pr.repo}`);
    title.appendChild(link);

    const meta = document.createElement("p");
    meta.className = "activity-card-meta";
    meta.textContent = `${formatRelativeUpdated(pr.updatedAt)} by @${pr.author}`;

    article.appendChild(repo);
    article.appendChild(title);
    article.appendChild(meta);
    cards.appendChild(article);
  });

  if (!rest.length) {
    listWrap.hidden = true;
    return;
  }

  listWrap.hidden = false;
  rest.forEach((pr) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = pr.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${pr.repo} · #${pr.number} ${pr.title}`;
    link.setAttribute("aria-label", `Open PR ${pr.number} in ${pr.repo}`);
    item.appendChild(link);
    list.appendChild(item);
  });
}

async function initOpenPullRequests(skipIfStaticLoaded) {
  const feed = document.querySelector("[data-pr-feed]");
  const status = document.querySelector("[data-pr-status]");
  if (!feed || !status) return;
  if (skipIfStaticLoaded) return;

  try {
    const all = await Promise.all(MAIN_REPOS.map((repo) => fetchOpenPullRequests(repo)));
    const merged = all
      .flat()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    renderOpenPullRequests(merged);
    showGhCacheNotice();
  } catch {
    feed.setAttribute("aria-busy", "false");
    status.textContent =
      "Could not load open pull requests (network or GitHub API rate limit).";
  }
}

function applyStaticProjectStats(payload) {
  if (!payload || typeof payload !== "object") return false;

  const repos = payload.repos;
  if (!repos || typeof repos !== "object") return false;

  const rows = Array.from(document.querySelectorAll(".project-stats[data-repo]"));
  let applied = 0;

  rows.forEach((row) => {
    const fullName = row.getAttribute("data-repo");
    const repoData = fullName ? repos[fullName] : null;
    if (!repoData) return;

    const commitEl = row.querySelector(".commit-activity");
    const contribEl = row.querySelector(".contributor-card");

    if (commitEl && repoData.commits) {
      const c = repoData.commits;
      if (c.noRelease) {
        setCommitBar(commitEl, { noRelease: true, branch: c.branch || "main" });
      } else if (typeof c.count === "number") {
        setCommitBar(commitEl, {
          count: c.count,
          tag: c.tag,
          branch: c.branch,
          compareUrl: c.compareUrl,
        });
      }
      applied += 1;
    }

    if (contribEl && repoData.contributors) {
      const k = repoData.contributors;
      setContributorCard(contribEl, {
        count: k.count,
        countIsLowerBound: Boolean(k.countIsLowerBound),
        contributors: k.list,
        contributorsUrl: `https://github.com/${fullName}/graphs/contributors`,
      });
    }
  });

  if (payload.pullRequests) {
    renderOpenPullRequests(payload.pullRequests);
  }

  return applied > 0;
}

async function loadStaticProjectStats() {
  try {
    const res = await fetch(GH_STATIC_STATS_URL, { cache: "no-cache" });
    if (!res.ok) return null;
    const payload = await res.json();
    if (!payload || typeof payload.fetchedAt !== "number") return null;
    if (Date.now() - payload.fetchedAt > GH_CACHE_STALE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

async function initProjectStats() {
  const rows = Array.from(document.querySelectorAll(".project-stats[data-repo]"));
  if (!rows.length) return;

  const results = await Promise.all(
    rows.map(async (row) => {
      const fullName = row.getAttribute("data-repo");
      const commitEl = row.querySelector(".commit-activity");
      const contribEl = row.querySelector(".contributor-card");

      if (!fullName || !commitEl || !contribEl) {
        return {
          fullName: null,
          commitEl,
          contribEl,
          commitRes: { status: "rejected" },
          contribRes: { status: "rejected" },
        };
      }

      const [commitRes, contribRes] = await Promise.allSettled([
        loadCommitsSinceRelease(fullName),
        fetchContributors(fullName),
      ]);

      return { fullName, commitEl, contribEl, commitRes, contribRes };
    })
  );

  results.forEach((r) => {
    if (!r) return;

    if (r.commitEl) {
      if (r.commitRes.status === "rejected") {
        setCommitBar(r.commitEl, { error: true });
      } else {
        const data = r.commitRes.value;
        if (!data) {
          setCommitBar(r.commitEl, { error: true });
        } else if (data.noRelease) {
          setCommitBar(r.commitEl, { noRelease: true, branch: data.branch });
        } else {
          const { count, tag, branch, compareUrl } = data;
          setCommitBar(r.commitEl, { count, tag, branch, compareUrl });
        }
      }
    }

    if (r.contribEl) {
      if (r.contribRes.status === "fulfilled" && r.fullName) {
        const payload = r.contribRes.value;
        setContributorCard(r.contribEl, {
          count: payload.count,
          countIsLowerBound: payload.countIsLowerBound,
          contributors: payload.contributors,
          contributorsUrl: `https://github.com/${r.fullName}/graphs/contributors`,
        });
      } else {
        setContributorCard(r.contribEl, { error: true });
      }
    }
  });

  showGhCacheNotice();
}

async function initPageData() {
  const staticPayload = await loadStaticProjectStats();
  const usedStatic =
    staticPayload !== null && applyStaticProjectStats(staticPayload);

  await Promise.allSettled([
    usedStatic ? Promise.resolve() : initProjectStats(),
    initOpenPullRequests(usedStatic),
    initBadgeCache(),
  ]);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPageData);
} else {
  initPageData();
}
