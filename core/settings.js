/* Settings in chrome.storage.local. Loaded only in extension pages, never in content scripts. */
self.PG = self.PG || {};

self.PG.settings = (function () {
  const KEY = "settings";
  const DEFAULTS = {
    maxPostsPerRun: 30,
    grabDelayMinSec: 4,
    grabDelayMaxSec: 9,
    transcriptEnabled: false,
    openaiApiKey: ""
  };

  async function get() {
    const stored = await chrome.storage.local.get(KEY);
    return { ...DEFAULTS, ...(stored[KEY] || {}) };
  }

  async function save(patch) {
    const next = { ...(await get()), ...patch };
    next.maxPostsPerRun = clamp(next.maxPostsPerRun, 1, 200, DEFAULTS.maxPostsPerRun);
    next.grabDelayMinSec = clamp(next.grabDelayMinSec, 2, 120, DEFAULTS.grabDelayMinSec);
    next.grabDelayMaxSec = clamp(next.grabDelayMaxSec, next.grabDelayMinSec, 300, DEFAULTS.grabDelayMaxSec);
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  }

  function clamp(value, min, max, fallback) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  return { get, save, DEFAULTS };
})();
