/* =====================================================================
 * Portfolio behaviour.
 *
 * Everything visible on the page comes from two public GitHub endpoints:
 *   GET /users/:user          -> avatar, name, followers, public repo count
 *   GET /users/:user/repos    -> every public repository
 *
 * There is no hardcoded project list anywhere. Push a new repository and
 * it appears here by itself. The only value worth editing is USERNAME.
 * ===================================================================== */

(function () {
  "use strict";

  /* ------------------------------- config ------------------------------- */

  const USERNAME = "ilcde";

  const API = "https://api.github.com";
  const PAGES_HOST = ".github.io";

  const CACHE_KEY = "portfolio:" + USERNAME + ":v1";
  const CACHE_TTL = 30 * 60 * 1000; // Anonymous callers get 60 requests/hour.

  const FEATURED_COUNT = 3;
  const MAX_TOPICS = 4;

  // The profile repository holds the GitHub README, not a project.
  const NOT_A_PROJECT = new Set([USERNAME.toLowerCase()]);

  // GitHub's own language colours, with a generated fallback for the rest.
  const LANG_COLORS = {
    "c": "#555555",
    "c++": "#f34b7d",
    "c#": "#178600",
    "assembly": "#6e4c13",
    "rust": "#dea584",
    "go": "#00add8",
    "java": "#b07219",
    "kotlin": "#a97bff",
    "python": "#3572a5",
    "javascript": "#f1e05a",
    "typescript": "#3178c6",
    "html": "#e34c26",
    "css": "#563d7c",
    "scss": "#c6538c",
    "shell": "#89e051",
    "makefile": "#427819",
    "cmake": "#da3434",
    "dockerfile": "#384d54",
    "php": "#4f5d95",
    "ruby": "#701516",
    "swift": "#f05138",
    "dart": "#00b4ab",
    "lua": "#000080",
    "vim script": "#199f4b",
    "jupyter notebook": "#da5b0b",
    "vue": "#41b883",
    "svelte": "#ff3e00",
    "sql": "#e38c00",
  };

  /* -------------------------------- state ------------------------------- */

  const state = {
    repos: [],
    user: null,
    fetchedAt: 0,
    query: "",
    language: "all",
    sort: "pushed",
  };

  const dom = {
    syncWrap: document.querySelector(".eyebrow--live"),
    sync: document.getElementById("sync-label"),
    avatar: document.getElementById("hero-avatar"),
    name: document.getElementById("hero-name"),
    stats: document.getElementById("stats"),
    featured: document.getElementById("featured"),
    repos: document.getElementById("repos"),
    filters: document.getElementById("filters"),
    resultLine: document.getElementById("result-line"),
    notice: document.getElementById("notice"),
    aboutMeta: document.getElementById("about-meta"),
    search: document.getElementById("search"),
    sort: document.getElementById("sort"),
    year: document.getElementById("year"),
  };

  /* ------------------------------- helpers ------------------------------ */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Known colour, otherwise a stable hue derived from the language name. */
  function langColor(language) {
    const known = LANG_COLORS[language.toLowerCase()];
    if (known) return known;

    let hash = 0;
    for (let i = 0; i < language.length; i += 1) {
      hash = (hash * 31 + language.charCodeAt(i)) % 360;
    }
    return "hsl(" + hash + ", 58%, 58%)";
  }

  function relativeTime(value) {
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return "recently";

    const minutes = Math.floor((Date.now() - then) / 60000);
    if (minutes < 1) return "this minute";
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");

    const days = Math.floor(hours / 24);
    if (days < 31) return days + (days === 1 ? " day ago" : " days ago");

    const months = Math.floor(days / 30.44);
    if (months < 12) return months + (months === 1 ? " month ago" : " months ago");

    const years = Math.floor(days / 365.25);
    return years + (years === 1 ? " year ago" : " years ago");
  }

  /** GitHub reports repository size in kilobytes. */
  function formatSize(kb) {
    if (!kb) return "";
    if (kb < 1024) return kb + " KB";
    return (kb / 1024).toFixed(1) + " MB";
  }

  function pagesUrl(name) {
    return "https://" + USERNAME.toLowerCase() + PAGES_HOST + "/" + name + "/";
  }

  function profileUrl() {
    return "https://github.com/" + USERNAME;
  }

  async function getJson(path) {
    const response = await fetch(API + path, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!response.ok) {
      const error = new Error("GitHub API replied " + response.status);
      error.status = response.status;
      // 403/429 with no quota left means the hourly limit is spent, not that
      // the profile is missing: worth a different message for the visitor.
      error.rateLimited =
        (response.status === 403 || response.status === 429) &&
        response.headers.get("x-ratelimit-remaining") === "0";
      throw error;
    }

    return response.json();
  }

  /* -------------------------------- cache ------------------------------- */

  function readCache() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.repos) || !parsed.fetchedAt) return null;
      return parsed;
    } catch (error) {
      return null; // Private mode, quota, or corrupted entry: just refetch.
    }
  }

  function writeCache() {
    try {
      window.localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ user: state.user, repos: state.repos, fetchedAt: state.fetchedAt })
      );
    } catch (error) {
      /* Nothing to do: the cache is an optimisation, not a requirement. */
    }
  }

  /* ------------------------------- loading ------------------------------ */

  /** Keeps only the fields the page uses, so the cache stays small. */
  function normalise(repo) {
    const homepage = (repo.homepage || "").trim();
    const license =
      repo.license && repo.license.spdx_id && repo.license.spdx_id !== "NOASSERTION"
        ? repo.license.spdx_id
        : "";

    return {
      name: repo.name,
      url: repo.html_url,
      description: (repo.description || "").trim(),
      language: repo.language || "",
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
      size: repo.size || 0,
      topics: Array.isArray(repo.topics) ? repo.topics : [],
      license: license,
      archived: Boolean(repo.archived),
      fork: Boolean(repo.fork),
      pushed: repo.pushed_at || repo.updated_at || "",
      created: repo.created_at || "",
      // An explicit homepage wins; otherwise a Pages site is the live demo.
      demo: homepage || (repo.has_pages ? pagesUrl(repo.name) : ""),
    };
  }

  async function load() {
    const cached = readCache();

    // Paint cached content first so the page is useful immediately.
    if (cached) {
      state.user = cached.user;
      state.repos = cached.repos;
      state.fetchedAt = cached.fetchedAt;
      apply();
      if (Date.now() - cached.fetchedAt < CACHE_TTL) return;
    }

    try {
      const [user, repos] = await Promise.all([
        getJson("/users/" + USERNAME),
        getJson("/users/" + USERNAME + "/repos?per_page=100&sort=pushed"),
      ]);

      state.user = user;
      state.repos = repos
        .filter((repo) => !NOT_A_PROJECT.has(repo.name.toLowerCase()))
        .map(normalise);
      state.fetchedAt = Date.now();

      writeCache();
      hideNotice();
      apply();
    } catch (error) {
      failed(error, Boolean(cached));
    }
  }

  /** Renders everything that depends on freshly loaded data. */
  function apply() {
    renderUser();
    renderFilters();
    render();
    setSync("synced with GitHub · " + relativeTime(state.fetchedAt), "");
  }

  function failed(error, hasCache) {
    const rateLimited = Boolean(error && error.rateLimited);

    if (hasCache) {
      // Stale data beats no data: keep what is on screen and say so.
      setSync("showing cached data · " + relativeTime(state.fetchedAt), "is-stale");
      showNotice(
        rateLimited
          ? "GitHub's hourly rate limit is reached, so these cards come from your last visit."
          : "Could not reach GitHub just now, so these cards come from your last visit.",
        "warn"
      );
      return;
    }

    setSync("GitHub unreachable", "is-error");
    showNotice(
      rateLimited
        ? "GitHub allows 60 unauthenticated requests per hour and that budget is spent. Try again shortly."
        : "The GitHub API did not answer, so the project list is empty right now.",
      "error"
    );
    renderFailure();
  }

  /* ------------------------------ rendering ----------------------------- */

  function setSync(text, modifier) {
    if (dom.sync) dom.sync.textContent = text;
    if (dom.syncWrap) dom.syncWrap.className = "eyebrow eyebrow--live " + modifier;
  }

  function showNotice(message, kind) {
    if (!dom.notice) return;
    dom.notice.className = "notice notice--" + kind;
    dom.notice.textContent = message;
    dom.notice.hidden = false;
  }

  function hideNotice() {
    if (!dom.notice) return;
    dom.notice.hidden = true;
    dom.notice.textContent = "";
  }

  function setStat(key, value) {
    const target = dom.stats && dom.stats.querySelector('[data-stat="' + key + '"]');
    if (target) target.textContent = value;
  }

  function renderUser() {
    const user = state.user;
    const stars = state.repos.reduce((total, repo) => total + repo.stars, 0);
    const languages = languageCounts();

    setStat("repos", String(user && user.public_repos ? user.public_repos : state.repos.length));
    setStat("stars", String(stars));
    setStat("followers", String(user && user.followers ? user.followers : 0));
    setStat("language", languages.length ? languages[0].language : "—");

    if (user) {
      if (dom.name && user.name) dom.name.textContent = user.name;
      if (dom.avatar && user.avatar_url) {
        dom.avatar.src = user.avatar_url;
        dom.avatar.alt = (user.name || USERNAME) + " on GitHub";
      }
    }

    if (dom.aboutMeta) {
      const parts = [];
      if (user && user.created_at) {
        const joined = new Date(user.created_at);
        parts.push(
          "on GitHub since " +
            joined.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
        );
      }
      parts.push(state.repos.length + " public projects");
      if (user && user.location) parts.push(user.location);
      // Placeholder bios such as "WIP" add noise, so skip the very short ones.
      if (user && user.bio && user.bio.trim().length > 12) parts.push(user.bio.trim());

      dom.aboutMeta.textContent = parts.join(" · ");
    }
  }

  /** Repos per language, most used first. Ties break on total size, then name. */
  function languageCounts() {
    const totals = new Map();

    for (const repo of state.repos) {
      if (!repo.language) continue;
      const entry =
        totals.get(repo.language) || { language: repo.language, count: 0, size: 0 };
      entry.count += 1;
      entry.size += repo.size;
      totals.set(repo.language, entry);
    }

    return [...totals.values()].sort(
      (a, b) => b.count - a.count || b.size - a.size || a.language.localeCompare(b.language)
    );
  }

  function renderFilters() {
    if (!dom.filters) return;
    dom.filters.textContent = "";

    const groups = [{ language: "all", count: state.repos.length }].concat(languageCounts());

    for (const group of groups) {
      const button = el("button", "pill");
      button.type = "button";
      button.dataset.language = group.language;
      button.setAttribute("aria-pressed", String(group.language === state.language));

      if (group.language !== "all") {
        const dot = el("span", "lang-dot");
        dot.style.background = langColor(group.language);
        button.append(dot);
      }

      button.append(
        document.createTextNode(group.language === "all" ? "All" : group.language),
        el("span", "pill__count", String(group.count))
      );
      dom.filters.append(button);
    }
  }

  /**
   * Ranking for the featured row. Real signals only: attention from others,
   * how much work is in the repo, whether it is documented, and how recent
   * it is. Forks and archives are pushed down.
   */
  function score(repo) {
    const ageDays = repo.pushed
      ? (Date.now() - new Date(repo.pushed).getTime()) / 86400000
      : 999;

    let value = repo.stars * 10 + repo.forks * 6;
    if (repo.description) value += 12;
    value += Math.min(repo.topics.length, 6) * 3;
    value += Math.min(repo.size / 500, 10);
    value += Math.max(0, 20 - ageDays / 9);
    if (repo.archived) value -= 15;
    if (repo.fork) value -= 40;

    return value;
  }

  function comparator() {
    switch (state.sort) {
      case "stars":
        return (a, b) => b.stars - a.stars || a.name.localeCompare(b.name);
      case "created":
        return (a, b) => new Date(b.created) - new Date(a.created);
      case "name":
        return (a, b) => a.name.localeCompare(b.name);
      case "size":
        return (a, b) => b.size - a.size;
      default:
        return (a, b) => new Date(b.pushed) - new Date(a.pushed);
    }
  }

  function matches(repo) {
    if (state.language !== "all" && repo.language !== state.language) return false;
    if (!state.query) return true;

    const haystack = [repo.name, repo.description, repo.language, repo.topics.join(" ")]
      .join(" ")
      .toLowerCase();
    return haystack.includes(state.query);
  }

  function repoCard(repo, isFeatured) {
    const card = el("article", "card repo" + (isFeatured ? " repo--featured" : ""));

    const head = el("div", "repo__head");
    const heading = el("h3", "repo__name");
    const link = el("a", null, repo.name);
    link.href = repo.url;
    link.target = "_blank";
    link.rel = "noopener";
    heading.append(link);
    head.append(heading);

    const badges = el("div", "badges");
    if (repo.stars) badges.append(el("span", "badge badge--star", "★ " + repo.stars));
    if (repo.archived) badges.append(el("span", "badge badge--archived", "archived"));
    if (repo.fork) badges.append(el("span", "badge badge--fork", "fork"));
    if (badges.childElementCount) head.append(badges);
    card.append(head);

    card.append(
      el("p", "repo__desc", repo.description || "No description on GitHub yet.")
    );

    if (repo.topics.length) {
      const topics = el("ul", "repo__topics");
      for (const topic of repo.topics.slice(0, MAX_TOPICS)) {
        topics.append(el("li", "topic", topic));
      }
      if (repo.topics.length > MAX_TOPICS) {
        topics.append(el("li", "topic", "+" + (repo.topics.length - MAX_TOPICS)));
      }
      card.append(topics);
    }

    const meta = el("div", "repo__meta");
    if (repo.language) {
      const language = el("span");
      const dot = el("span", "lang-dot");
      dot.style.background = langColor(repo.language);
      language.append(dot, document.createTextNode(repo.language));
      meta.append(language);
    }
    if (repo.pushed) meta.append(el("span", null, "updated " + relativeTime(repo.pushed)));
    if (repo.size) meta.append(el("span", null, formatSize(repo.size)));
    if (repo.license) meta.append(el("span", null, repo.license));
    card.append(meta);

    const links = el("div", "repo__links");
    const code = el("a", null, "Code");
    code.href = repo.url;
    code.target = "_blank";
    code.rel = "noopener";
    links.append(code);

    if (repo.demo) {
      const demo = el("a", "is-demo", "Live demo ↗");
      demo.href = repo.demo;
      demo.target = "_blank";
      demo.rel = "noopener";
      links.append(demo);
    }
    card.append(links);

    return card;
  }

  function render() {
    if (!dom.repos) return;

    const filtering = state.query !== "" || state.language !== "all";
    const ranked = state.repos.slice().sort((a, b) => score(b) - score(a));
    const featured = filtering ? [] : ranked.slice(0, FEATURED_COUNT);
    const rest = state.repos
      .filter((repo) => !featured.includes(repo))
      .filter(matches)
      .sort(comparator());

    if (dom.featured) {
      dom.featured.textContent = "";
      for (const repo of featured) dom.featured.append(repoCard(repo, true));
    }

    dom.repos.textContent = "";
    for (const repo of rest) dom.repos.append(repoCard(repo, false));

    if (!featured.length && !rest.length) {
      dom.repos.append(
        el("p", "empty", "No repository matches that search. Try a different word.")
      );
    }

    if (dom.resultLine) {
      const shown = featured.length + rest.length;
      dom.resultLine.textContent =
        "showing " + shown + " of " + state.repos.length + " repositories";
    }
  }

  /** Last resort: no data at all, so point visitors at GitHub directly. */
  function renderFailure() {
    if (dom.featured) dom.featured.textContent = "";
    if (dom.resultLine) dom.resultLine.textContent = "";
    if (!dom.repos) return;

    dom.repos.textContent = "";
    const empty = el("p", "empty");
    empty.append(document.createTextNode("Project list unavailable. "));

    const link = el("a", null, "Browse the repositories on GitHub");
    link.href = profileUrl() + "?tab=repositories";
    link.target = "_blank";
    link.rel = "noopener";
    empty.append(link);

    dom.repos.append(empty);
  }

  /* ----------------------------- interaction ---------------------------- */

  function debounce(fn, wait) {
    let timer = 0;
    return function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(fn, wait);
    };
  }

  function wireControls() {
    if (dom.search) {
      dom.search.addEventListener(
        "input",
        debounce(() => {
          state.query = dom.search.value.trim().toLowerCase();
          render();
        }, 160)
      );
    }

    if (dom.sort) {
      dom.sort.addEventListener("change", () => {
        state.sort = dom.sort.value;
        render();
      });
    }

    // Delegated, because the pills are rebuilt whenever data arrives.
    if (dom.filters) {
      dom.filters.addEventListener("click", (event) => {
        const pill = event.target.closest(".pill");
        if (!pill) return;

        state.language = pill.dataset.language;
        for (const button of dom.filters.querySelectorAll(".pill")) {
          button.setAttribute("aria-pressed", String(button === pill));
        }
        render();
      });
    }
  }

  function wireScrollSpy() {
    const items = [...document.querySelectorAll(".nav-item")];
    const sections = [...document.querySelectorAll("main section[id]")];
    if (!items.length || !sections.length) return;

    const activate = (id) => {
      for (const item of items) {
        item.classList.toggle("active", item.getAttribute("href") === "#" + id);
      }
    };

    if (!("IntersectionObserver" in window)) return;

    // A band across the middle of the viewport decides the current section,
    // which is far cheaper and steadier than measuring offsets on scroll.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) activate(entry.target.id);
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    for (const section of sections) observer.observe(section);
    activate(sections[0].id);
  }

  function wireReveal() {
    const targets = [...document.querySelectorAll(".reveal")];
    const show = (target) => target.classList.add("is-visible");

    if (!("IntersectionObserver" in window)) {
      targets.forEach(show);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 }
    );

    for (const target of targets) {
      // Anything already on screen shows at once, with no flash of hidden text.
      if (target.getBoundingClientRect().top < window.innerHeight) show(target);
      else observer.observe(target);
    }

    // Safety net: content must never stay hidden because an observer misfired.
    window.setTimeout(() => targets.forEach(show), 1200);
  }

  /* -------------------------------- boot -------------------------------- */

  if (dom.year) dom.year.textContent = String(new Date().getFullYear());

  wireControls();
  wireScrollSpy();
  wireReveal();
  load();
})();
