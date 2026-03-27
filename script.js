const revealNodes = document.querySelectorAll(".reveal");

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

function setCommitBar(el, { count, pct, tag, branch, compareUrl, error, noRelease }) {
  const countEl = el.querySelector('[data-role="count"]');
  const fillEl = el.querySelector('[data-role="fill"]');
  const trackEl = el.querySelector(".commit-bar-track");
  const metaEl = el.querySelector('[data-role="meta"]');

  el.setAttribute("aria-busy", "false");

  if (error) {
    if (countEl) countEl.textContent = "—";
    if (fillEl) fillEl.style.width = "0%";
    if (trackEl) {
      trackEl.setAttribute("aria-valuenow", "0");
      trackEl.setAttribute("aria-valuetext", "Unable to load");
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
    if (trackEl) {
      trackEl.setAttribute("aria-valuenow", "0");
      trackEl.setAttribute("aria-valuetext", "No release");
    }
    if (metaEl) {
      metaEl.textContent =
        "No published GitHub release yet; compare is not available.";
    }
    return;
  }

  const n = typeof count === "number" ? count : 0;
  const width = Math.max(0, Math.min(100, typeof pct === "number" ? pct : 0));

  if (countEl) countEl.textContent = String(n);
  if (fillEl) fillEl.style.width = `${width}%`;
  if (trackEl) {
    trackEl.setAttribute("aria-valuenow", String(Math.round(width)));
    trackEl.setAttribute(
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
  const repoRes = await fetch(`${GH_API}/${fullName}`, { headers: ghHeaders });
  if (!repoRes.ok) {
    throw new Error("repo");
  }
  const repo = await repoRes.json();
  const branch = repo.default_branch || "main";

  const relRes = await fetch(`${GH_API}/${fullName}/releases/latest`, {
    headers: ghHeaders,
  });
  if (relRes.status === 404) {
    return { noRelease: true, branch };
  }
  if (!relRes.ok) {
    throw new Error("release");
  }
  const rel = await relRes.json();
  const tag = rel.tag_name;
  if (!tag) {
    return { noRelease: true, branch };
  }

  const comparePath = `${encodeURIComponent(tag)}...${encodeURIComponent(branch)}`;
  const compareRes = await fetch(`${GH_API}/${fullName}/compare/${comparePath}`, {
    headers: ghHeaders,
  });
  if (!compareRes.ok) {
    throw new Error("compare");
  }
  const compare = await compareRes.json();
  const count =
    typeof compare.ahead_by === "number"
      ? compare.ahead_by
      : typeof compare.total_commits === "number"
        ? compare.total_commits
        : 0;
  const compareUrl =
    typeof compare.html_url === "string" ? compare.html_url : null;

  return { count, tag, branch, compareUrl };
}

const MAX_AVATAR_TILES = 32;

async function fetchContributors(fullName) {
  const perPage = 100;
  let page = 1;
  const contributors = [];
  const maxPages = 40;

  while (page <= maxPages) {
    const res = await fetch(
      `${GH_API}/${fullName}/contributors?per_page=${perPage}&page=${page}`,
      { headers: ghHeaders }
    );
    if (!res.ok) {
      throw new Error("contributors");
    }
    const batch = await res.json();
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
    if (batch.length < perPage) {
      break;
    }
    page += 1;
  }

  return { count: contributors.length, contributors };
}

function setContributorCard(el, { count, contributors, contributorsUrl, error }) {
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

  if (countEl) countEl.textContent = String(count);

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

  const numericCounts = results
    .map((r) => {
      if (!r || r.commitRes.status !== "fulfilled") return null;
      const val = r.commitRes.value;
      if (!val || val.noRelease) return null;
      return val.count;
    })
    .filter((c) => typeof c === "number");
  const maxCount = numericCounts.length ? Math.max(...numericCounts) : 0;

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
          const pct =
            maxCount > 0 && typeof count === "number"
              ? (count / maxCount) * 100
              : count && count > 0
                ? 100
                : 0;
          setCommitBar(r.commitEl, { count, pct, tag, branch, compareUrl });
        }
      }
    }

    if (r.contribEl) {
      if (r.contribRes.status === "fulfilled" && r.fullName) {
        const payload = r.contribRes.value;
        setContributorCard(r.contribEl, {
          count: payload.count,
          contributors: payload.contributors,
          contributorsUrl: `https://github.com/${r.fullName}/graphs/contributors`,
        });
      } else {
        setContributorCard(r.contribEl, { error: true });
      }
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initProjectStats);
} else {
  initProjectStats();
}
