(function () {
  const { $, setStatus, formatCompact, formatCount, engagementRate, formatPercent, saveText } = PG.ui;
  const U = PG.utils;
  const say = (message, kind) => setStatus($("#status"), message, kind);

  const posts = new Map();
  const selected = new Set();
  const results = new Map(); // id -> { state, detail }
  let sourceTabId = null;
  let accountName = "";
  let busy = false;
  let stopRequested = false;

  const has = (n) => n !== null && n !== undefined;

  /** Posts with views first (by views), then the rest by likes. */
  function sortedPosts() {
    return [...posts.values()].sort((a, b) => {
      if (has(a.views) !== has(b.views)) return has(a.views) ? -1 : 1;
      if (has(a.views) && a.views !== b.views) return b.views - a.views;
      return (b.likes ?? -1) - (a.likes ?? -1);
    });
  }

  function loadThumbnail(img, url) {
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener(
      "error",
      async () => {
        // Some CDNs refuse to be embedded; this page's host permissions can still read them.
        try {
          const response = await fetch(url, { credentials: "omit" });
          if (response.ok) img.src = URL.createObjectURL(await response.blob());
        } catch (_) {
          /* leave the empty placeholder */
        }
      },
      { once: true }
    );
    img.src = url;
  }

  function buildRow(post) {
    const row = document.createElement("tr");

    const checkCell = row.insertCell();
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selected.has(post.id);
    box.setAttribute("aria-label", `Select post ${post.id}`);
    box.addEventListener("change", () => {
      if (box.checked) selected.add(post.id);
      else selected.delete(post.id);
      updateControls();
    });
    checkCell.append(box);

    const link = document.createElement("a");
    link.className = "thumb";
    link.href = post.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.title = post.caption || post.url;
    if (U.isHttpUrl(post.thumbnail)) {
      const img = document.createElement("img");
      loadThumbnail(img, post.thumbnail);
      link.append(img);
    }
    row.insertCell().append(link);

    const numberCell = (value, title) => {
      const cell = row.insertCell();
      cell.className = "num";
      cell.textContent = value;
      if (title) cell.title = title;
    };
    numberCell(formatCompact(post.views), formatCount(post.views));
    numberCell(formatCompact(post.likes), formatCount(post.likes));
    numberCell(formatPercent(engagementRate(post)), `${formatCount(post.comments)} comments`);

    const resultCell = row.insertCell();
    resultCell.className = "result";
    const result = results.get(post.id);
    if (result) {
      resultCell.dataset.state = result.state;
      resultCell.textContent = { ok: "✓", error: "✕", running: "…" }[result.state];
      resultCell.title = result.detail || "";
    }
    return row;
  }

  function render() {
    const rows = sortedPosts();
    $("#rows").replaceChildren(...rows.map(buildRow));
    $("#table").hidden = rows.length === 0;
    const note = $("#sort-note");
    note.hidden = rows.length === 0;
    if (rows.some((p) => has(p.views))) note.textContent = "Sorted by views. Posts with no visible view count follow, by likes.";
    else if (rows.some((p) => has(p.likes))) note.textContent = "No view counts visible here, so sorted by likes.";
    else note.textContent = "No counts visible in this grid. On Instagram, try the profile's Reels tab.";
    updateControls();
  }

  function updateControls() {
    const hasRows = posts.size > 0;
    $("#rank").disabled = busy;
    $("#load-more").disabled = busy || !hasRows;
    $("#top-10").disabled = busy || !hasRows;
    $("#export").disabled = busy || selected.size === 0;
    $("#grab").disabled = busy || selected.size === 0;
    $("#selection").textContent = `${selected.size} selected of ${posts.size}`;
    const all = $("#select-all");
    all.checked = hasRows && selected.size === posts.size;
    all.indeterminate = selected.size > 0 && selected.size < posts.size;
  }

  function setBusy(value) {
    busy = value;
    updateControls();
  }

  function merge(list) {
    let added = 0;
    for (const post of list) {
      if (!posts.has(post.id)) added++;
      posts.set(post.id, { ...posts.get(post.id), ...post });
    }
    return added;
  }

  /* ---------- collect ---------- */

  async function rank() {
    setBusy(true);
    say("Reading the posts already loaded on this page…");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !U.detectPlatform(tab.url)) {
        throw new U.PGError("Open an Instagram or TikTok profile in this tab first.");
      }
      const ping = await U.sendToTab(tab.id, { type: "PING" });
      if (ping.page.type !== "profile") throw new U.PGError("This tab isn't a profile page. Open a profile, then click Rank posts.");
      const { posts: list } = await U.sendToTab(tab.id, { type: "GET_PROFILE_POSTS" });
      if (ping.page.account !== accountName) {
        posts.clear();
        selected.clear();
        results.clear();
      }
      accountName = ping.page.account;
      sourceTabId = tab.id;
      merge(list);
      $("#target").textContent = `@${accountName}`;
      say(`Found ${posts.size} post${posts.size === 1 ? "" : "s"}.`, "ok");
    } catch (e) {
      say(e.message, "error");
    } finally {
      setBusy(false);
      render();
    }
  }

  async function loadMore() {
    setBusy(true);
    say("Scrolling one screen…");
    try {
      const { posts: list, reachedEnd } = await U.sendToTab(sourceTabId, { type: "LOAD_MORE" });
      const added = merge(list);
      if (added) say(`Added ${added} post${added === 1 ? "" : "s"}. ${posts.size} total.`, "ok");
      else say(reachedEnd ? "Reached the end of the grid." : "No new posts yet. Click Load more again.", "warn");
    } catch (e) {
      say(e.message, "error");
    } finally {
      setBusy(false);
      render();
    }
  }

  /* ---------- export ---------- */

  function exportSelected() {
    const rows = sortedPosts().filter((p) => selected.has(p.id));
    const columns = [
      { header: "platform", value: (p) => p.platform },
      { header: "account", value: (p) => p.account },
      { header: "url", value: (p) => p.url },
      { header: "views", value: (p) => p.views },
      { header: "likes", value: (p) => p.likes },
      { header: "comments", value: (p) => p.comments },
      { header: "engagement_rate", value: (p) => { const r = engagementRate(p); return r === null ? "" : r.toFixed(4); } },
      { header: "caption", value: (p) => p.caption },
      { header: "thumbnail", value: (p) => p.thumbnail }
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${U.sanitizeSegment(accountName)}_posts_${stamp}.csv`;
    saveText(filename, PG.csv.build(rows, columns), "text/csv").then(
      () => say(`Saved ${rows.length} row${rows.length === 1 ? "" : "s"} to Downloads/${filename}.`, "ok"),
      (e) => say(e.message, "error")
    );
  }

  /* ---------- grab ---------- */

  function waitForTabLoad(tabId, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const done = (fn, value) => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        fn(value);
      };
      const listener = (id, info) => {
        if (id === tabId && info.status === "complete") done(resolve);
      };
      const timer = setTimeout(() => done(reject, new U.PGError("The post took too long to load.")), timeoutMs);
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  async function waitForPostPage(tabId) {
    for (let i = 0; i < 20; i++) {
      try {
        const ping = await U.sendToTab(tabId, { type: "PING" });
        if (ping.page.type === "post") return;
      } catch (_) {
        /* content script isn't ready yet */
      }
      await U.sleep(500);
    }
    throw new U.PGError("The page didn't open as a post. You may need to log in, or a captcha may be showing.");
  }

  async function stoppableSleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end && !stopRequested) await U.sleep(200);
  }

  async function grabOne(post) {
    const tab = await chrome.tabs.create({ url: post.url, active: true });
    try {
      await waitForTabLoad(tab.id);
      await waitForPostPage(tab.id);
      await stoppableSleep(U.randInt(1500, 3000)); // let the page finish rendering
      if (stopRequested) throw new U.PGError("Stopped.");
      return await U.sendToBackground({ type: "RUN_SAVE", tabId: tab.id, mode: "all" });
    } finally {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }

  async function grabSelected() {
    const settings = await PG.settings.get();
    const all = sortedPosts().filter((p) => selected.has(p.id));
    const queue = all.slice(0, settings.maxPostsPerRun);
    stopRequested = false;
    setBusy(true);
    $("#stop").hidden = false;
    let succeeded = 0;
    let failed = 0;
    let processed = 0;
    for (const [index, post] of queue.entries()) {
      if (stopRequested) break;
      say(`Grabbing ${index + 1} of ${queue.length}…`);
      results.set(post.id, { state: "running" });
      render();
      try {
        const result = await grabOne(post);
        results.set(post.id, { state: result.failed ? "error" : "ok", detail: result.message });
        succeeded++;
      } catch (e) {
        results.set(post.id, { state: "error", detail: e.message });
        failed++;
      }
      processed++;
      render();
      if (index < queue.length - 1 && !stopRequested) {
        const seconds = U.randInt(settings.grabDelayMinSec, settings.grabDelayMaxSec);
        say(`Waiting ${seconds}s before the next post…`);
        await stoppableSleep(seconds * 1000);
      }
    }
    $("#stop").hidden = true;
    setBusy(false);
    if (sourceTabId !== null) chrome.tabs.update(sourceTabId, { active: true }).catch(() => {});
    const parts = [`Done: ${succeeded} grabbed, ${failed} failed.`];
    if (stopRequested) parts.push(`Stopped after ${processed} of ${queue.length}.`);
    if (all.length > queue.length) parts.push(`Limited to ${queue.length} of ${all.length} selected by the per-run cap (change it in Settings).`);
    if (failed) parts.push("Hover ✕ for the reason.");
    say(parts.join(" "), failed || stopRequested || all.length > queue.length ? "warn" : "ok");
    render();
  }

  /* ---------- wiring ---------- */

  $("#rank").addEventListener("click", rank);
  $("#load-more").addEventListener("click", loadMore);
  $("#export").addEventListener("click", exportSelected);
  $("#grab").addEventListener("click", grabSelected);
  $("#stop").addEventListener("click", () => {
    stopRequested = true;
    say("Stopping after the current step…");
  });
  $("#top-10").addEventListener("click", () => {
    selected.clear();
    for (const post of sortedPosts().slice(0, 10)) selected.add(post.id);
    render();
  });
  $("#select-all").addEventListener("change", (event) => {
    selected.clear();
    if (event.target.checked) for (const id of posts.keys()) selected.add(id);
    render();
  });
  say("Open a profile, then click Rank posts.");
})();
