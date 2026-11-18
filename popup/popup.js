(async function () {
  const { $, setStatus, formatCount, formatCompact } = PG.ui;
  const U = PG.utils;
  const statusEl = $("#status");
  const say = (message, kind) => setStatus(statusEl, message, kind);

  let tab = null;
  let post = null;

  $("#open-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

  function showEmpty(message) {
    $("#empty-message").textContent = message;
    $("#view-empty").hidden = false;
  }

  function setBusy(busy) {
    for (const button of document.querySelectorAll("#view-post button")) {
      if (button.id === "get-transcript") continue;
      button.disabled = busy;
    }
  }

  async function runAction(label, action) {
    setBusy(true);
    say(label);
    try {
      await action();
    } catch (e) {
      say(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function renderPost() {
    $("#post-account").textContent = post.account ? `@${post.account}` : "Unknown account";
    $("#post-type").textContent = post.mediaType;
    $("#post-caption").textContent = post.caption || "No caption found";
    for (const name of ["views", "likes", "comments", "shares"]) {
      const el = $(`#stat-${name}`);
      el.textContent = formatCompact(post[name]);
      el.title = formatCount(post[name]);
    }
    $("#view-post").hidden = false;
    if (post.warnings.length) say(post.warnings.join(" "), "warn");
  }

  async function save(mode, label) {
    await runAction(label, async () => {
      // The worker owns the job, so it finishes even if this popup closes.
      const result = await U.sendToBackground({ type: "RUN_SAVE", tabId: tab.id, mode });
      say(result.message, result.failed ? "warn" : "ok");
    });
  }

  /* ---------- transcript ---------- */

  async function setupTranscript() {
    const button = $("#get-transcript");
    const settings = await PG.settings.get();
    if (!settings.transcriptEnabled) {
      button.disabled = true;
      button.title = "Transcripts are off. Turn them on in Settings.";
      return;
    }
    if (!settings.openaiApiKey) {
      button.disabled = true;
      button.title = "Add your OpenAI API key in Settings to enable transcripts.";
      return;
    }
    button.title = "Sends this video's file to OpenAI Whisper using your API key.";
    button.addEventListener("click", async () => {
      button.disabled = true;
      say("Sending to Whisper. You can close this popup; the result will be here when you reopen it.");
      try {
        await U.sendToBackground({ type: "TRANSCRIBE", tabId: tab.id });
        say("Transcript ready.", "ok");
      } catch (e) {
        say(e.message, "error");
      } finally {
        button.disabled = false;
      }
    });
    const key = `${post.platform}:${post.id}`;
    const render = (state) => {
      if (!state || state.key !== key) return;
      if (state.status === "running") {
        button.disabled = true;
        button.textContent = "Transcribing…";
      } else {
        button.disabled = false;
        button.textContent = "Get transcript";
      }
      if (state.status === "done") {
        $("#transcript-text").value = state.text;
        $("#transcript-box").hidden = false;
      }
      if (state.status === "error") say(state.error, "error");
    };
    const stored = await chrome.storage.session.get("lastTranscript");
    render(stored.lastTranscript);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "session" && changes.lastTranscript) render(changes.lastTranscript.newValue);
    });
  }

  /* ---------- swipe file ---------- */

  async function setupSwipe() {
    const existing = await PG.swipe.find(post);
    if (existing) {
      $("#swipe-hook").value = existing.hookType;
      $("#swipe-format").value = existing.format;
      $("#swipe-tags").value = existing.tags;
      $("#swipe-notes").value = existing.notes;
    }
    $("#swipe-save").addEventListener("click", () =>
      runAction("Saving to swipe file…", async () => {
        const { updated, total } = await PG.swipe.save(post, {
          hookType: $("#swipe-hook").value.trim(),
          format: $("#swipe-format").value.trim(),
          tags: $("#swipe-tags").value.trim(),
          notes: $("#swipe-notes").value.trim()
        });
        say(`${updated ? "Updated" : "Saved"}. Your swipe file has ${total} post${total === 1 ? "" : "s"}.`, "ok");
      })
    );
  }

  /* ---------- start ---------- */

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = tab && tab.url ? U.detectPlatform(tab.url) : null;
  if (!platform) {
    showEmpty("Open an Instagram or TikTok post or profile, then click the icon again.");
    return;
  }
  const name = PG_SELECTORS[platform].displayName;

  let ping;
  try {
    ping = await U.sendToTab(tab.id, { type: "PING" });
  } catch (e) {
    say(e.message, "error");
    return;
  }

  if (ping.page.type === "profile") {
    $("#profile-name").textContent = `@${ping.page.account}`;
    $("#view-profile").hidden = false;
    $("#open-panel").addEventListener("click", () => {
      // Must run directly in the click: Chrome requires a user gesture.
      chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    });
    return;
  }

  if (ping.page.type !== "post") {
    showEmpty(`This ${name} page isn't a post or profile. Open one, then click the icon again.`);
    return;
  }

  say("Reading this post…");
  try {
    ({ post } = await U.sendToTab(tab.id, { type: "GET_POST", textOnly: true }));
  } catch (e) {
    say(e.message, "error");
    return;
  }
  say("");
  renderPost();

  $("#copy-caption").addEventListener("click", async () => {
    if (!post.caption) {
      say(`Couldn't find caption, ${name} selectors may be outdated.`, "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(post.caption);
      say("Caption copied, hashtags included.", "ok");
    } catch (e) {
      say(`Couldn't copy to the clipboard (${e.message}).`, "error");
    }
  });
  $("#copy-transcript").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#transcript-text").value);
    say("Transcript copied.", "ok");
  });
  $("#save-images").addEventListener("click", () => save("images", "Saving images…"));
  $("#save-video").addEventListener("click", () => save("video", "Saving video…"));
  $("#export-all").addEventListener("click", () => save("all", "Exporting caption, details and media…"));

  await setupTranscript();
  await setupSwipe();
})();
