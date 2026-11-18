/* Shared helpers. Loaded in content scripts, extension pages and the service worker. */
self.PG = self.PG || {};
self.PG.adapters = self.PG.adapters || {};

self.PG.utils = (function () {
  class PGError extends Error {
    constructor(message) {
      super(message);
      this.name = "PGError";
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

  /** First value that is not null, undefined or an empty string. 0 counts as a value. */
  function first(...values) {
    for (const v of values) if (v !== null && v !== undefined && v !== "") return v;
    return null;
  }

  function getPath(obj, path) {
    let cur = obj;
    for (const key of path.split(".")) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[key];
    }
    return cur;
  }

  function firstPath(obj, paths) {
    for (const p of paths) {
      const v = getPath(obj, p);
      if (v !== null && v !== undefined && v !== "") return v;
    }
    return null;
  }

  /** Iterative search; budget stops pathological JSON from hanging the page. */
  function deepCollect(root, predicate, budget = 400000, limit = Infinity) {
    const out = [];
    const stack = [root];
    let visited = 0;
    while (stack.length && visited < budget && out.length < limit) {
      const node = stack.pop();
      visited++;
      if (!node || typeof node !== "object") continue;
      if (!Array.isArray(node) && predicate(node)) out.push(node);
      const values = Object.values(node);
      for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] && typeof values[i] === "object") stack.push(values[i]);
      }
    }
    return out;
  }

  const deepFind = (root, predicate, budget) => deepCollect(root, predicate, budget, 1)[0] || null;

  function safeJson(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  /** "1,234" / "1.2K" / "3.4M views" to a number; anything else to null. */
  function parseCount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined) return null;
    const m = String(value)
      .replace(/ /g, " ")
      .trim()
      .match(/^(\d[\d.,]*)\s*([KMB])?(?:\s*(?:views?|plays?|likes?|comments?|shares?))?$/i);
    if (!m) return null;
    const suffix = m[2] ? m[2].toUpperCase() : "";
    if (suffix) {
      const n = parseFloat(m[1].replace(",", "."));
      return Number.isFinite(n) ? Math.round(n * { K: 1e3, M: 1e6, B: 1e9 }[suffix]) : null;
    }
    const n = parseInt(m[1].replace(/[.,]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  function toIso(value) {
    if (value === null || value === undefined || value === "") return null;
    let d;
    if (typeof value === "number" || /^\d{9,13}$/.test(String(value))) {
      const n = Number(value);
      d = new Date(n < 1e12 ? n * 1000 : n);
    } else {
      d = new Date(value);
    }
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const isHttpUrl = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

  const extractHashtags = (text) => (text ? [...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])] : []);

  /** Makes one path segment safe on Windows, macOS and Linux. */
  function sanitizeSegment(value, fallback = "unknown") {
    const cleaned = String(value || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 80);
    if (!cleaned || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return fallback;
    return cleaned;
  }

  function extFromUrl(url, fallback) {
    try {
      const m = new URL(url).pathname.match(/\.(jpe?g|png|webp|heic|avif|mp4|mov|webm)$/i);
      return m ? m[1].toLowerCase().replace("jpeg", "jpg") : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function detectPlatform(url) {
    let host;
    try {
      host = new URL(url).hostname;
    } catch (_) {
      return null;
    }
    for (const [key, cfg] of Object.entries(self.PG_SELECTORS)) {
      if (cfg.hostPattern.test(host)) return key;
    }
    return null;
  }

  /** A second copy of the page you are on: SPA navigation leaves embedded data stale. */
  async function fetchFreshDocument() {
    try {
      const res = await fetch(location.href, { credentials: "include" });
      if (!res.ok) return null;
      return new DOMParser().parseFromString(await res.text(), "text/html");
    } catch (_) {
      return null;
    }
  }

  function queryFirst(root, selectors) {
    for (const s of [].concat(selectors)) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function friendlyConnectionError(e) {
    const m = String((e && e.message) || e);
    if (/Receiving end does not exist|Could not establish connection/i.test(m)) {
      return "Post Grabber isn't connected to this tab yet. Reload the page and try again.";
    }
    return m;
  }

  function unwrap(response) {
    if (!response) throw new PGError("No response from Post Grabber. Reload the page and try again.");
    if (!response.ok) throw new PGError(response.error || "Unknown error.");
    return response.data;
  }

  async function sendToTab(tabId, message) {
    let response;
    try {
      response = await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      throw new PGError(friendlyConnectionError(e));
    }
    return unwrap(response);
  }

  async function sendToBackground(message) {
    return unwrap(await chrome.runtime.sendMessage(message));
  }

  return {
    PGError, sleep, randInt, first, getPath, firstPath, deepCollect, deepFind, safeJson,
    parseCount, toIso, isHttpUrl, extractHashtags, sanitizeSegment, extFromUrl,
    detectPlatform, fetchFreshDocument, queryFirst, sendToTab, sendToBackground
  };
})();
