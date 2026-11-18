/*
 * TikTok adapter. Interface: detectPageType(), getPost(), getProfilePosts(), getMediaUrls().
 * Reads the JSON embedded in the page first and only touches the DOM as a fallback.
 */
self.PG.adapters.tiktok = (function () {
  const S = self.PG_SELECTORS.tiktok;
  const U = self.PG.utils;
  const { PGError, first, firstPath, queryFirst, parseCount } = U;

  let itemCache = { url: null, item: null };
  let profileCache = { account: null, posts: new Map() };

  function detectPageType() {
    const path = location.pathname;
    const post = path.match(S.url.post);
    if (post) return { type: "post", subtype: post[2], id: post[3], account: post[1] };
    const profile = path.match(S.url.profile);
    if (profile) return { type: "profile", account: profile[1], tab: "posts" };
    return { type: "unknown" };
  }

  function readEmbeddedJson(doc) {
    const out = [];
    for (const { selector } of S.scripts) {
      const el = doc.querySelector(selector);
      const json = el ? U.safeJson(el.textContent) : null;
      if (json) out.push(json);
    }
    return out;
  }

  function findItem(doc, id) {
    const roots = readEmbeddedJson(doc);
    for (const root of roots) {
      for (const template of S.itemPaths) {
        const item = U.getPath(root, template.replace("{id}", id));
        if (item && String(item.id) === id) return item;
      }
    }
    for (const root of roots) {
      const item = U.deepFind(root, (n) => String(n.id) === id && ("desc" in n || "stats" in n), S.limits.embeddedNodeBudget);
      if (item) return item;
    }
    return null;
  }

  async function loadItem(id) {
    if (itemCache.url === location.href && itemCache.item) return itemCache.item;
    let item = findItem(document, id);
    if (!item) {
      // The embedded JSON is only written on full page loads, so after in-app
      // navigation it describes a different post. Re-read this URL once.
      const fresh = await U.fetchFreshDocument();
      if (fresh) item = findItem(fresh, id);
    }
    itemCache = { url: location.href, item };
    return item;
  }

  const domText = (selectors) => {
    const el = queryFirst(document, selectors);
    return el ? el.innerText.trim() : null;
  };
  const domCount = (selectors) => parseCount(domText(selectors));

  async function getPost() {
    const page = detectPageType();
    if (page.type !== "post") throw new PGError("This isn't a TikTok video or photo page.");
    const item = await loadItem(page.id);
    const P = S.paths, D = S.dom;
    const fromItem = (paths) => (item ? firstPath(item, paths) : null);
    const stat = (paths, selectors) => first(parseCount(fromItem(paths)), domCount(selectors));

    const rawAccount = fromItem(P.account);
    const caption = first(fromItem(P.caption), domText(D.caption));
    const warnings = [];
    if (!item) warnings.push("TikTok's embedded page data wasn't found, so these details came from visible text only. TikTok selectors may be outdated (selectors.js: tiktok.itemPaths).");
    if (caption === null) warnings.push("Couldn't find caption, TikTok selectors may be outdated (selectors.js: tiktok.paths.caption / tiktok.dom.caption).");

    const isPhoto = page.subtype === "photo" || Boolean(fromItem(P.images));
    return {
      platform: "tiktok",
      id: page.id,
      url: `https://www.tiktok.com/@${page.account}/${isPhoto ? "photo" : "video"}/${page.id}`,
      account: first(typeof rawAccount === "string" ? rawAccount : null, page.account, domText(D.account)),
      caption,
      hashtags: U.extractHashtags(caption),
      date: U.toIso(fromItem(P.createTime)),
      likes: stat(P.likes, D.likes),
      comments: stat(P.comments, D.comments),
      shares: stat(P.shares, D.shares),
      views: stat(P.views, D.views),
      mediaType: isPhoto ? "photo" : "video",
      warnings
    };
  }

  function videoUrlsFromItem(item) {
    const P = S.paths;
    const urls = P.videoUrls.map((p) => U.getPath(item, p));
    for (const rate of U.getPath(item, P.bitrates[0]) || []) {
      urls.push(...(firstPath(rate, P.bitrateUrls) || []));
    }
    return [...new Set(urls.filter(U.isHttpUrl))];
  }

  const NO_VIDEO_URL = "TikTok didn't expose a direct video URL on this page, so the video can't be saved. Reloading the page sometimes helps.";

  async function getMediaUrls() {
    const page = detectPageType();
    if (page.type !== "post") throw new PGError("This isn't a TikTok video or photo page.");
    const item = await loadItem(page.id);
    const P = S.paths;

    if (item) {
      const images = firstPath(item, P.images);
      if (Array.isArray(images) && images.length) {
        const media = images.map((img) => ({ type: "image", url: firstPath(img, P.imageUrl) })).filter((m) => U.isHttpUrl(m.url));
        if (media.length) return media;
      }
      const urls = videoUrlsFromItem(item);
      const cover = firstPath(item, P.cover);
      if (urls.length) {
        const media = [{ type: "video", url: urls[0], fallbacks: urls.slice(1, 4) }];
        if (U.isHttpUrl(cover)) media.push({ type: "cover", url: cover });
        return media;
      }
    }

    if (page.subtype === "photo") {
      const seen = new Set();
      const media = [];
      for (const img of document.querySelectorAll(S.dom.photoImages)) {
        const url = img.currentSrc || img.src;
        if (U.isHttpUrl(url) && Math.max(img.naturalWidth, img.width) >= S.limits.minImagePx && !seen.has(url)) {
          seen.add(url);
          media.push({ type: "image", url });
        }
      }
      if (!media.length) throw new PGError("Couldn't find the photo-mode images, TikTok selectors may be outdated (selectors.js: tiktok.paths.images / tiktok.dom.photoImages).");
      return media;
    }

    const video = document.querySelector(S.dom.video);
    const source = document.querySelector(S.dom.videoSource);
    const url = first(video && U.isHttpUrl(video.src) ? video.src : null, source && U.isHttpUrl(source.src) ? source.src : null);
    return [{ type: "video", url, reason: NO_VIDEO_URL }];
  }

  function readEmbeddedProfile() {
    const byId = new Map();
    for (const root of readEmbeddedJson(document)) {
      const nodes = U.deepCollect(root, (n) => n.id && n.stats && typeof n.stats === "object", S.limits.embeddedNodeBudget);
      for (const node of nodes) if (!byId.has(String(node.id))) byId.set(String(node.id), node);
    }
    return byId;
  }

  async function getProfilePosts() {
    const page = detectPageType();
    if (page.type !== "profile") throw new PGError("This isn't a TikTok profile page.");
    if (profileCache.account !== page.account) profileCache = { account: page.account, posts: new Map() };
    const tiles = [...document.querySelectorAll(S.profile.tile)];
    if (!tiles.length && !profileCache.posts.size) {
      throw new PGError("Couldn't find any posts in the grid, TikTok selectors may be outdated (selectors.js: tiktok.profile.tile). TikTok may also be showing a captcha or an empty profile.");
    }
    const embedded = readEmbeddedProfile();
    const P = S.paths;
    for (const tile of tiles) {
      const link = tile.querySelector(S.profile.link);
      const match = link && link.href.match(S.profile.linkId);
      if (!match) continue;
      const [, account, kind, id] = match;
      const e = embedded.get(id) || null;
      const fromItem = (paths) => (e ? firstPath(e, paths) : null);
      const previous = profileCache.posts.get(id) || {};
      const img = tile.querySelector(S.profile.thumbnail);
      const viewsEl = tile.querySelector(S.profile.views);
      profileCache.posts.set(id, {
        platform: "tiktok",
        id,
        url: `https://www.tiktok.com/@${account}/${kind}/${id}`,
        account,
        thumbnail: first(img && (img.currentSrc || img.src), fromItem(P.thumbnail), previous.thumbnail),
        caption: first(fromItem(P.caption), img && img.alt, previous.caption),
        views: first(viewsEl ? parseCount(viewsEl.textContent) : null, parseCount(fromItem(P.views)), previous.views),
        likes: first(parseCount(fromItem(P.likes)), previous.likes),
        comments: first(parseCount(fromItem(P.comments)), previous.comments)
      });
    }
    return [...profileCache.posts.values()];
  }

  return { detectPageType, getPost, getProfilePosts, getMediaUrls };
})();
