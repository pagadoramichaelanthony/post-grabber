/*
 * Whisper transcription. Runs in the service worker so the API key never reaches a
 * content script, and so a job survives the popup closing.
 */
self.PG = self.PG || {};

self.PG.transcript = (function () {
  const U = self.PG.utils;
  const { PGError } = U;
  const MAX_BYTES = 25 * 1024 * 1024; // Whisper's upload limit
  const STATE_KEY = "lastTranscript";
  const jobs = new Map();

  chrome.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith("media:")) return;
    const job = jobs.get(port.name.slice(6));
    if (!job) return;
    const chunks = [];
    port.onMessage.addListener((m) => {
      if (m.chunk) {
        chunks.push(Uint8Array.from(atob(m.chunk), (c) => c.charCodeAt(0)));
        return;
      }
      if (m.error) job.reject(new PGError(m.error));
      else if (m.done) job.resolve(new Blob(chunks, { type: m.mime || "video/mp4" }));
      port.disconnect();
    });
    port.onDisconnect.addListener(() => job.reject(new PGError("The page closed before the video finished transferring.")));
  });

  function tooLarge(bytes) {
    const mb = Math.round(bytes / (1024 * 1024));
    return new PGError(`This video is ${mb} MB, over Whisper's 25 MB limit, so it wasn't sent.`);
  }

  async function fromPage(tabId, url) {
    const jobId = crypto.randomUUID();
    const finished = new Promise((resolve, reject) => jobs.set(jobId, { resolve, reject }));
    finished.catch(() => {}); // handled below; stops a stray rejection if sendToTab fails first
    try {
      await U.sendToTab(tabId, { type: "STREAM_MEDIA", url, jobId, maxBytes: MAX_BYTES });
      return await finished;
    } catch (e) {
      const m = String(e.message).match(/^TOO_LARGE:(\d+)/);
      throw m ? tooLarge(Number(m[1])) : e;
    } finally {
      jobs.delete(jobId);
    }
  }

  async function fromBackground(url) {
    let response;
    try {
      response = await fetch(url, { credentials: "omit" });
    } catch (e) {
      throw new PGError(`Couldn't fetch the video (${e.message}).`);
    }
    if (!response.ok) throw new PGError(`Couldn't fetch the video (HTTP ${response.status}). Reload the page and try again.`);
    const blob = await response.blob();
    if (blob.size > MAX_BYTES) throw tooLarge(blob.size);
    return blob;
  }

  async function getVideoBlob(tabId, item, methods) {
    let lastError;
    for (const url of [item.url, ...(item.fallbacks || [])].slice(0, 3)) {
      for (const method of methods) {
        try {
          return method === "page" ? await fromPage(tabId, url) : await fromBackground(url);
        } catch (e) {
          if (/25 MB limit/.test(e.message)) throw e;
          lastError = e;
        }
      }
    }
    throw lastError;
  }

  async function callWhisper(blob, id, apiKey) {
    const form = new FormData();
    form.append("file", blob, `${U.sanitizeSegment(id, "audio")}.mp4`);
    form.append("model", "whisper-1");
    form.append("response_format", "text");
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form
      });
    } catch (e) {
      throw new PGError(`Couldn't reach OpenAI (${e.message}).`);
    }
    if (response.ok) return (await response.text()).trim();
    if (response.status === 401) throw new PGError("OpenAI rejected your API key. Check it on the Settings page.");
    if (response.status === 429) throw new PGError("OpenAI says you've hit a rate limit or run out of credit (HTTP 429).");
    if (response.status === 413) throw new PGError("OpenAI says this file is too large (HTTP 413).");
    const detail = U.safeJson(await response.text());
    throw new PGError(`OpenAI returned an error (HTTP ${response.status})${detail && detail.error ? `: ${detail.error.message}` : "."}`);
  }

  const setState = (state) => chrome.storage.session.set({ [STATE_KEY]: state });

  async function run(tabId, settings) {
    if (!settings.transcriptEnabled) throw new PGError("Transcripts are turned off. Enable them on the Settings page.");
    if (!settings.openaiApiKey) throw new PGError("Add your OpenAI API key on the Settings page first.");
    const { post, media, download } = await U.sendToTab(tabId, { type: "GET_POST" });
    const key = `${post.platform}:${post.id}`;
    await setState({ key, status: "running" });
    try {
      const video = media.find((m) => m.type === "video");
      if (!video) throw new PGError("This post has no video, so there's nothing to transcribe.");
      if (!video.url) throw new PGError(video.reason || "No direct video URL is available to transcribe.");
      const blob = await getVideoBlob(tabId, video, download.video);
      const text = await callWhisper(blob, post.id, settings.openaiApiKey);
      await setState({ key, status: "done", text });
      return { text };
    } catch (e) {
      await setState({ key, status: "error", error: e.message });
      throw e;
    }
  }

  return { run, STATE_KEY };
})();
