/* File saving. Runs in the service worker. */
self.PG = self.PG || {};

self.PG.downloads = (function () {
  const U = self.PG.utils;
  const { PGError } = U;

  // url -> { filename, onStart, started }. Tells Chrome which folder each of our files goes in.
  const pending = new Map();

  function onDeterminingFilename(item, suggest) {
    const entry = pending.get(item.url);
    if (!entry) return; // not one of ours: leave it alone
    entry.onStart(item.id);
    suggest({ filename: entry.filename, conflictAction: "uniquify" });
  }

  // This event can interfere with other extensions' downloads, so it's only
  // listened to while one of our own files is being named.
  function track(url, filename) {
    let onStart;
    const started = new Promise((resolve) => (onStart = resolve));
    const entry = { filename, onStart, started };
    pending.set(url, entry);
    if (!chrome.downloads.onDeterminingFilename.hasListener(onDeterminingFilename)) {
      chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);
    }
    return entry;
  }

  function untrack(url) {
    pending.delete(url);
    if (!pending.size) chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilename);
  }

  const INTERRUPT_MESSAGES = {
    SERVER_FORBIDDEN: "the server refused the file (403). The link may need the page's cookies or may have expired",
    SERVER_UNAUTHORIZED: "the server requires authorization for this file",
    SERVER_BAD_CONTENT: "the file link is no longer valid",
    NETWORK_FAILED: "the network connection failed",
    FILE_ACCESS_DENIED: "Chrome couldn't write to your Downloads folder",
    FILE_NO_SPACE: "your disk is full",
    USER_CANCELED: "the download was canceled"
  };

  function waitForCompletion(id, timeoutMs = 180000) {
    return new Promise((resolve, reject) => {
      const finish = (fn, value) => {
        clearTimeout(timer);
        chrome.downloads.onChanged.removeListener(listener);
        fn(value);
      };
      const check = (state, error) => {
        if (state === "complete") finish(resolve);
        else if (state === "interrupted") finish(reject, new PGError(INTERRUPT_MESSAGES[error] || `download failed (${error})`));
      };
      const listener = (delta) => {
        if (delta.id === id && delta.state) {
          if (delta.state.current === "interrupted") {
            chrome.downloads.search({ id }).then(([d]) => check("interrupted", d && d.error));
          } else {
            check(delta.state.current);
          }
        }
      };
      const timer = setTimeout(() => finish(reject, new PGError("the download timed out")), timeoutMs);
      chrome.downloads.onChanged.addListener(listener);
      chrome.downloads.search({ id }).then(([d]) => d && check(d.state, d.error));
    });
  }

  async function downloadDirect(url, filename) {
    track(url, filename);
    try {
      let id;
      try {
        id = await chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
      } catch (e) {
        throw new PGError(`Chrome rejected the download (${e.message})`);
      }
      await waitForCompletion(id);
    } finally {
      untrack(url);
    }
  }

  /** The page fetches the file with its own session, then Chrome saves the result. */
  async function downloadViaPage(tabId, url, filename) {
    const { blobUrl } = await U.sendToTab(tabId, { type: "PAGE_FETCH", url });
    try {
      await downloadDirect(blobUrl, filename);
      return;
    } catch (_) {
      // Some Chrome versions won't hand a page's blob to the downloads API: click a link instead.
    }
    const entry = track(blobUrl, filename);
    try {
      await U.sendToTab(tabId, { type: "CLICK_BLOB", blobUrl, filename });
      const id = await Promise.race([entry.started, U.sleep(10000).then(() => null)]);
      if (id === null) throw new PGError('Chrome didn\'t start the download. If you see a "download multiple files" prompt, allow it for this site');
      await waitForCompletion(id);
    } finally {
      untrack(blobUrl);
    }
  }

  async function saveOne(tabId, item, filename, methodOrder) {
    const urls = [item.url, ...(item.fallbacks || [])];
    let firstError;
    let attempts = 0;
    for (const url of urls) {
      for (const method of methodOrder) {
        if (attempts++ >= 5) throw firstError;
        try {
          if (method === "page") await downloadViaPage(tabId, url, filename);
          else await downloadDirect(url, filename);
          return;
        } catch (e) {
          // The preferred method's error says the most about what went wrong.
          firstError = firstError || e;
        }
      }
    }
    throw firstError;
  }

  /** Saves entries one at a time with a short random pause. Never throws for a single file. */
  async function saveAll(tabId, entries, downloadConfig) {
    const failed = [];
    let saved = 0;
    for (const { item, filename } of entries) {
      try {
        await saveOne(tabId, item, filename, item.type === "video" ? downloadConfig.video : downloadConfig.image);
        saved++;
      } catch (e) {
        failed.push({ name: filename.split("/").pop(), reason: e.message });
      }
      await U.sleep(U.randInt(250, 600));
    }
    return { saved, failed };
  }

  async function saveText(filename, text) {
    await downloadDirect(`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`, filename);
  }

  return { downloadDirect, saveAll, saveText };
})();
