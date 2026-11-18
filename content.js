/*
 * Content script. Does nothing until an extension page sends it a message,
 * which only happens after you click a button.
 */
(function () {
  const U = self.PG.utils;
  const { PGError } = U;
  const platform = U.detectPlatform(location.href);
  const adapter = self.PG.adapters[platform];
  if (!adapter) return;

  const config = self.PG_SELECTORS[platform];
  let loadMoreBusy = false;

  function findScroller() {
    const anchor = document.querySelector(config.profile.tile);
    for (let el = anchor && anchor.parentElement; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 10) return el;
    }
    return document.scrollingElement || document.documentElement;
  }

  /** Fetches in the page's context so its cookies and referer apply. */
  async function fetchMedia(url, maxBytes) {
    let response;
    let networkError;
    for (const credentials of ["include", "omit"]) {
      try {
        response = await fetch(url, { credentials });
        break;
      } catch (e) {
        networkError = e;
      }
    }
    if (!response) throw new PGError(`The browser blocked the in-page download (${networkError.message}).`);
    if (!response.ok) throw new PGError(`${config.displayName} refused the file (HTTP ${response.status}). The link may have expired, so reload the page and try again.`);
    if (/text\/html/i.test(response.headers.get("content-type") || "")) {
      throw new PGError(`${config.displayName} returned a web page instead of the file. The link may have expired, so reload the page and try again.`);
    }
    const declared = Number(response.headers.get("content-length")) || 0;
    if (maxBytes && declared > maxBytes) throw new PGError(`TOO_LARGE:${declared}`);
    const blob = await response.blob();
    if (maxBytes && blob.size > maxBytes) throw new PGError(`TOO_LARGE:${blob.size}`);
    if (blob.size < 1024) throw new PGError(`${config.displayName} returned an empty file.`);
    return blob;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32766) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 32766));
    }
    return btoa(binary);
  }

  const handlers = {
    PING: () => ({ platform, page: adapter.detectPageType() }),

    // Opening the popup reads text only. Media is read when you click a save button,
    // because a carousel fallback may need to step through slides.
    GET_POST: async ({ textOnly }) => {
      const post = await adapter.getPost();
      if (textOnly) return { post };
      let media = [];
      let mediaError = null;
      try {
        media = await adapter.getMediaUrls();
      } catch (e) {
        mediaError = e.message;
      }
      return { post, media, mediaError, download: config.download };
    },

    GET_PROFILE_POSTS: async () => ({ page: adapter.detectPageType(), posts: await adapter.getProfilePosts() }),

    /** Exactly one screen per click, then a random 1.5-3s pause. Never loops. */
    LOAD_MORE: async () => {
      if (loadMoreBusy) throw new PGError("Still loading the previous screen.");
      loadMoreBusy = true;
      try {
        const scroller = findScroller();
        const before = scroller.scrollTop;
        scroller.scrollBy({ top: Math.round(window.innerHeight * 0.9), behavior: "smooth" });
        await U.sleep(U.randInt(1500, 3000));
        const posts = await adapter.getProfilePosts();
        return { posts, reachedEnd: Math.abs(scroller.scrollTop - before) < 2 };
      } finally {
        loadMoreBusy = false;
      }
    },

    PAGE_FETCH: async ({ url }) => {
      const blobUrl = URL.createObjectURL(await fetchMedia(url));
      setTimeout(() => URL.revokeObjectURL(blobUrl), 300000);
      return { blobUrl };
    },

    CLICK_BLOB: ({ blobUrl, filename }) => {
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename.split("/").pop();
      a.style.display = "none";
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      return {};
    },

    /** Sends file bytes to the service worker in chunks, for transcription. */
    STREAM_MEDIA: async ({ url, jobId, maxBytes }) => {
      const port = chrome.runtime.connect({ name: `media:${jobId}` });
      try {
        const blob = await fetchMedia(url, maxBytes);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const chunkSize = 3 * 1024 * 1024;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          port.postMessage({ chunk: bytesToBase64(bytes.subarray(offset, offset + chunkSize)) });
        }
        port.postMessage({ done: true, mime: blob.type });
      } catch (e) {
        port.postMessage({ error: e.message });
      }
      return {};
    }
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    const handler = handlers[message.type];
    if (!handler) return false;
    Promise.resolve()
      .then(() => handler(message))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (e) => sendResponse({ ok: false, error: e.message || String(e) })
      );
    return true;
  });
})();
