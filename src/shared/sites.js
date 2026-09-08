/* Shared by the content script, extension pages and service worker. No page code is executed. */
(() => {
  "use strict";

  const HOSTS = Object.freeze({
    "anibt.net": { type: "ani-bt", label: "AniBT" },
    "mikanani.me": { type: "mikan", label: "Mikan" },
    "mikanime.tv": { type: "mikan", label: "Mikan" },
    "mikan.sakiko.de": { type: "mikan", label: "Mikan" },
    "animes.garden": { type: "anime-garden", label: "AnimeGarden" },
    "api.animes.garden": { type: "anime-garden", label: "AnimeGarden" }
  });

  function asUrl(raw, baseUrl) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    try {
      const url = new URL(raw.trim().replace(/&amp;/gi, "&"), baseUrl);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
    } catch {
      return null;
    }
  }

  function getSite(raw) {
    const url = asUrl(raw);
    const site = url && Object.hasOwn(HOSTS, url.hostname) && HOSTS[url.hostname];
    return site ? { ...site } : null;
  }

  function values(params, key, ignoreCase = false) {
    return [...params].filter(([name]) => ignoreCase ? name.toLowerCase() === key.toLowerCase() : name === key)
      .map(([, value]) => value);
  }

  function singleValue(params, key, ignoreCase = false) {
    const found = values(params, key, ignoreCase);
    return found.length === 1 && found[0].trim() ? found[0] : null;
  }

  function validId(value) {
    return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
  }

  function feedId(url, type) {
    const key = type === "mikan" ? "bangumiId" : type === "ani-bt" ? "bgmId" : "subject";
    return validId(singleValue(url.searchParams, key, type === "mikan"));
  }

  function normalizeMikan(url) {
    url.pathname = "/RSS/Bangumi";
    // Mikan accepts case-insensitive keys, but ANI-RSS's getBangumiId reads the exact spelling.
    // Change only key names so unrelated filter values retain their original encoding.
    url.search = url.search.slice(1).split("&").map(part => {
      const equal = part.indexOf("=");
      const rawKey = equal < 0 ? part : part.slice(0, equal);
      let key;
      try { key = decodeURIComponent(rawKey.replace(/\+/g, " ")).toLowerCase(); }
      catch { return part; }
      const canonical = key === "bangumiid" ? "bangumiId" : key === "subgroupid" ? "subgroupid" : null;
      return canonical ? canonical + (equal < 0 ? "" : part.slice(equal)) : part;
    }).join("&");
  }

  function parseFeedUrl(raw, baseUrl) {
    const url = asUrl(raw, baseUrl);
    const site = url && getSite(url.href);
    if (!site) return null;
    const { type } = site;
    if (type === "mikan" && !/^\/RSS\/Bangumi\/?$/i.test(url.pathname)) return null;
    if (type === "ani-bt" && url.pathname !== "/rss/anime.xml") return null;
    if (type === "anime-garden" && (url.hostname !== "api.animes.garden" || url.pathname !== "/feed.xml")) return null;
    const id = feedId(url, type);
    if (!id) return null;
    if (type === "mikan") normalizeMikan(url);
    url.hash = "";
    const groupKey = type === "mikan" ? "subgroupid" : type === "ani-bt" ? "groupSlug" : "fansub";
    const group = singleValue(url.searchParams, groupKey, type === "mikan");
    if (!group) return null;
    const feed = { url: url.href, type, label: `${site.label} · ${type === "mikan" ? `字幕组 ${group}` : group}` };
    if (type !== "mikan") {
      feed.bgmUrl = `https://bgm.tv/subject/${id}`;
      if (group) feed.subgroup = group;
    }
    return feed;
  }

  function all(document, selector) {
    return document && typeof document.querySelectorAll === "function" ? [...document.querySelectorAll(selector)] : [];
  }

  function attr(element, name) {
    return element && typeof element.getAttribute === "function" ? element.getAttribute(name) || "" : "";
  }

  function text(element) {
    return String(element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function route(url) {
    // Support hash routers as well as History API navigation; ordinary anchors stay on the current route.
    return url.hash.startsWith("#/") ? asUrl(url.hash.slice(1), url.origin) || url : url;
  }

  function subjectFromUrl(url, site) {
    const current = route(url);
    const { type } = site;
    let id = null;
    if (type === "mikan") id = validId(current.pathname.match(/^\/Home\/Bangumi\/([1-9]\d*)\/?$/i)?.[1]);
    if (type === "ani-bt") id = validId(current.pathname.match(/^\/anime\/([1-9]\d*)\/?$/)?.[1]);
    if (type === "anime-garden") {
      id = validId(current.pathname.match(/^\/subject\/([1-9]\d*)\/?$/)?.[1]);
      const subjects = values(current.searchParams, "subject");
      if (subjects.length) {
        const filtered = validId(singleValue(current.searchParams, "subject"));
        if (!filtered || (id && filtered !== id)) return null;
        id = filtered;
      }
    }
    if (!id && parseFeedUrl(url.href)) id = feedId(url, type);
    if (!id) return null;
    const subject = {
      type,
      id,
      url: type === "mikan" ? `${url.origin}/Home/Bangumi/${id}` : type === "ani-bt" ? `${url.origin}/anime/${id}` : `https://animes.garden/subject/${id}`
    };
    if (type !== "mikan") subject.bgmUrl = `https://bgm.tv/subject/${id}`;
    return subject;
  }

  function mikanBgmUrl(document) {
    // Read the current work's information block, never a recommendation/sidebar Bangumi link.
    const ids = new Set();
    for (const anchor of all(document, ".bangumi-info a[href]")) {
      const url = asUrl(attr(anchor, "href"));
      if (!url || !["bgm.tv", "bangumi.tv", "chii.in"].includes(url.hostname)) continue;
      const id = validId(url.pathname.match(/^\/subject\/([1-9]\d*)\/?$/)?.[1]);
      if (id) ids.add(id);
    }
    return ids.size === 1 ? `https://bgm.tv/subject/${[...ids][0]}` : null;
  }

  function pageTitle(document, site, subject) {
    const selectors = subject && site.type === "mikan" ? [".bangumi-title", "h1"] : ["main h1", "h1"];
    for (const selector of selectors) {
      const title = text(all(document, selector)[0]);
      if (title) return title.slice(0, 500);
    }
    return String(document?.title || site?.label || "").replace(/\s+/g, " ").trim().slice(0, 500);
  }

  function collectPage(document, href) {
    const url = asUrl(href);
    const site = url && getSite(url.href);
    if (!site) return { site: null, title: String(document?.title || ""), feeds: [], subject: null };
    const subject = subjectFromUrl(url, site);
    if (subject?.type === "mikan") {
      const bgmUrl = mikanBgmUrl(document);
      if (bgmUrl) subject.bgmUrl = bgmUrl;
    }
    const feeds = new Map();
    const add = (raw, element) => {
      const feed = parseFeedUrl(raw, url.href);
      if (!feed || feed.type !== site.type) return;
      // A SPA can still display the previous work's DOM after its address has changed.
      if (subject && feedId(new URL(feed.url), feed.type) !== subject.id) return;
      if (feed.type === "mikan") {
        const groupId = singleValue(new URL(feed.url).searchParams, "subgroupid", true);
        const group = groupId && all(document, "a.subgroup-name[data-anchor]")
          .find(anchor => attr(anchor, "data-anchor") === `#${groupId}`);
        const name = text(group);
        if (name) feed.label = `Mikan · ${name}`;
        // Both are required to bypass ANI-RSS's own Mikan metadata lookup safely.
        if (name && subject?.bgmUrl) {
          feed.subgroup = name;
          feed.bgmUrl = subject.bgmUrl;
        }
      } else if (!feed.subgroup) {
        const label = text(element) || attr(element, "title");
        if (label && !/^rss$/i.test(label)) feed.label = `${site.label} · ${label.slice(0, 150)}`;
      }
      const key = new URL(feed.url);
      key.searchParams.sort();
      if (!feeds.has(key.href)) feeds.set(key.href, feed);
    };
    add(url.href);
    for (const element of all(document, "a[href], link[href], [data-clipboard-text], [data-rss], [data-rss-url], input[value], textarea")) {
      if (element.closest?.("[data-ani-rss-extension]")) continue;
      for (const name of ["href", "data-clipboard-text", "data-rss", "data-rss-url", "value"]) add(attr(element, name), element);
      if (element.tagName?.toLowerCase() === "textarea") add(element.value || element.textContent, element);
    }
    return { site, title: pageTitle(document, site, subject), feeds: [...feeds.values()], subject };
  }

  globalThis.AniRssSites = Object.freeze({ getSite, parseFeedUrl, collectPage });
})();
