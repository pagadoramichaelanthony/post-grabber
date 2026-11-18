/* Service worker: runs save and transcript jobs requested by the popup and side panel. */
importScripts("selectors.js", "core/utils.js", "core/settings.js", "core/downloads.js", "core/transcript.js");

const { PG } = self;
const U = PG.utils;
const { PGError } = U;

// Keeps the stored API key out of reach of content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

/** Stops Chrome from suspending the worker during a long job. */
async function withKeepAlive(job) {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  try {
    return await job();
  } finally {
    clearInterval(timer);
  }
}

const value = (v) => (v === null || v === undefined ? "not visible" : String(v));

function postText(post) {
  return [
    "CAPTION",
    post.caption || "(no caption found)",
    "",
    `URL: ${post.url}`,
    `Account: ${value(post.account)}`,
    `Date: ${value(post.date)}`,
    `Likes: ${value(post.likes)}`,
    `Comments: ${value(post.comments)}`,
    `Shares: ${value(post.shares)}`,
    `Views: ${value(post.views)}`,
    ""
  ].join("\r\n");
}

const pad = (n) => String(n).padStart(2, "0");

function imageEntry(folder, item, number) {
  return { item, filename: `${folder}/${pad(number)}.${U.extFromUrl(item.url, "jpg")}` };
}

function summarize(folder, result, notes) {
  const parts = [`Saved ${result.saved} file${result.saved === 1 ? "" : "s"} to Downloads/${folder}.`];
  if (result.failed.length) {
    parts.push(`${result.failed.length} failed: ${result.failed.map((f) => `${f.name} (${f.reason})`).join("; ")}.`);
  }
  return { message: parts.concat(notes).join(" "), saved: result.saved, failed: result.failed.length, folder };
}

async function runSave(tabId, mode) {
  const { post, media, mediaError, download } = await U.sendToTab(tabId, { type: "GET_POST" });
  const folder = U.sanitizeSegment(`${post.account || "unknown"}_${post.id}`);
  const images = media.filter((m) => m.type === "image" && m.url);
  const cover = media.find((m) => m.type === "cover" && m.url);
  const videos = media.filter((m) => m.type === "video");
  const usableVideos = videos.filter((m) => m.url);
  const missingVideo = videos.find((m) => !m.url);
  const notes = [];

  if (mode === "images") {
    if (mediaError) throw new PGError(mediaError);
    if (!images.length && !cover) throw new PGError("This post has no images to save.");
    const entries = images.length
      ? images.map((item, i) => imageEntry(folder, item, i + 1))
      : [{ item: cover, filename: `${folder}/cover.${U.extFromUrl(cover.url, "jpg")}` }];
    if (!images.length) notes.push("This is a video post, so its cover image was saved.");
    return summarize(folder, await PG.downloads.saveAll(tabId, entries, download), notes);
  }

  if (mode === "video") {
    if (mediaError) throw new PGError(mediaError);
    if (!videos.length) throw new PGError("This post has no video. Use Save images instead.");
    if (!usableVideos.length) throw new PGError(missingVideo.reason || "No direct video URL is available on this page.");
    const entries = usableVideos.map((item, i) => ({
      item,
      filename: `${folder}/${usableVideos.length > 1 ? `video_${pad(i + 1)}` : "video"}.mp4`
    }));
    const result = await PG.downloads.saveAll(tabId, entries, download);
    if (!result.saved) throw new PGError(`Couldn't save the video: ${result.failed[0].reason}.`);
    return summarize(folder, result, notes);
  }

  // Export all: text file plus every available file, numbered in slide order.
  await PG.downloads.saveText(`${folder}/post.txt`, postText(post));
  const entries = [];
  const carousel = post.mediaType === "carousel" || post.mediaType === "photo";
  let slide = 0;
  for (const item of media) {
    if (item.type === "cover") {
      if (item.url) entries.push({ item, filename: `${folder}/cover.${U.extFromUrl(item.url, "jpg")}` });
      continue;
    }
    slide++;
    if (!item.url) continue;
    if (item.type === "image") entries.push(imageEntry(folder, item, slide));
    else entries.push({ item, filename: `${folder}/${carousel ? pad(slide) : "video"}.mp4` });
  }
  const result = await PG.downloads.saveAll(tabId, entries, download);
  result.saved += 1; // post.txt
  if (missingVideo) notes.push(`Video skipped: ${missingVideo.reason}`);
  if (mediaError) notes.push(`Media skipped: ${mediaError}`);
  return summarize(folder, result, notes);
}

const handlers = {
  RUN_SAVE: ({ tabId, mode }) => withKeepAlive(() => runSave(tabId, mode)),
  DOWNLOAD_URL: ({ url, filename }) => withKeepAlive(() => PG.downloads.downloadDirect(url, filename)).then(() => ({})),
  TRANSCRIBE: async ({ tabId }) => {
    const settings = await PG.settings.get();
    return withKeepAlive(() => PG.transcript.run(tabId, settings));
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message.type];
  if (!handler) return false;
  // Jobs start only from the popup, side panel or settings page, never from a site's tab.
  if (!(sender.url || "").startsWith(chrome.runtime.getURL(""))) {
    sendResponse({ ok: false, error: "Not allowed from this context." });
    return false;
  }
  Promise.resolve()
    .then(() => handler(message))
    .then(
      (data) => sendResponse({ ok: true, data }),
      (e) => sendResponse({ ok: false, error: e.message || String(e) })
    );
  return true;
});
