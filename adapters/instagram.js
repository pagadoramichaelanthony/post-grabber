/*
 * Instagram adapter. Interface: detectPageType(), getPost(), getProfilePosts(), getMediaUrls().
 * Caption order: og: tags, JSON-LD, embedded page JSON, aria-labels, DOM text.
 * Media needs the embedded JSON first, because og:image only ever shows the first slide.
 */
self.PG.adapters.instagram = (function () {
  const S = self.PG_SELECTORS.instagram;
  const U = self.PG.utils;
  const { PGError, first, firstPath, queryFirst, parseCount } = U;

  let sourceCache = { url: null, sources: null };
  let profileCache = { account: null, posts: new Map() };

  function detectPageType() {
    const path = location.pathname;
    const post = path.match(S.url.post);
    if (post && !(post[1] && S.url.reservedNames.includes(post[1].toLowerCase()))) {
      return { type: "post", subtype: post[2] === "p" ? "post" : "reel", id: post[3], account: post[1] || null };
    }
    const profile = path.match(S.url.profile);
    if (profile && !S.url.reservedNames.includes(profile[1].toLowerCase())) {
      return { type: "profile", account: profile[1], tab: profile[2] || "posts" };
    }
    return { type: "unknown" };
  }

  /* ---------- source readers: each takes a Document so a fresh copy works too ---------- */

  function metaContent(doc, selectors) {
    const el = queryFirst(doc, selectors);
    return el ? el.getAttribute("content") : null;
  }

  function readMeta(doc, id) {
    const ogUrl = metaContent(doc, S.meta.ogUrl);
    if (!ogUrl || !ogUrl.includes(id)) return null; // missing, or left over from the previous page
    const description = metaContent(doc, S.meta.ogDescription) || metaContent(doc, S.meta.description) || "";
    const title = metaContent(doc, S.meta.ogTitle) || "";
    const out = {
      image: metaContent(doc, S.meta.ogImage),
      video: metaContent(doc, S.meta.ogVideo),
      isVideo: /video/i.test(metaContent(doc, S.meta.ogType) || "")
    };
    const parsed = description.match(S.metaParsers.description);
    if (parsed) {
      out.likes = parseCount(parsed[1]);
      out.comments = parseCount(parsed[2]);
      out.account = parsed[3];
      out.date = U.toIso(parsed[4]);
      out.caption = parsed[5].trim();
    }
    const titled = title.match(S.metaParsers.title);
    if (titled && !out.caption) out.caption = titled[1].trim();
    const handle = title.match(S.metaParsers.titleAccount);
    if (handle && !out.account) out.account = handle[1];
    return out;
  }

  function readJsonLd(doc, id, metaIsFresh) {
    const J = S.jsonLd;
    for (const script of doc.querySelectorAll(J.scripts)) {
      const parsed = U.safeJson(script.textContent);
      if (!parsed) continue;
      for (const item of [].concat(parsed)) {
        const url = firstPath(item, J.url);
        if (url ? !String(url).includes(id) : !metaIsFresh) continue;
        const caption = firstPath(item, J.caption);
        const out = { caption, account: firstPath(item, J.account), date: U.toIso(firstPath(item, J.date)) };
        for (const stat of [].concat(item.interactionStatistic || [])) {
          const type = String(stat.interactionType && (stat.interactionType["@type"] || stat.interactionType));
          for (const [name, pattern] of Object.entries(J.statTypes)) {
            if (pattern.test(type)) out[name] = parseCount(stat.userInteractionCount);
          }
        }
        const urlOf = (v) => (typeof v === "string" ? v : v && (v.contentUrl || v.url));
        out.images = [].concat(item.image || []).map(urlOf).filter(U.isHttpUrl);
        out.videos = [].concat(item.video || []).map(urlOf).filter(U.isHttpUrl);
        if (caption || out.images.length || out.videos.length) return out;
      }
    }
    return null;
  }

  function bestCandidateUrl(candidates) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const best = [...candidates].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
    return best.url || best.src || null;
  }

  function mediaFromNode(node) {
    const P = S.embedded.paths;
    const image = bestCandidateUrl(firstPath(node, P.imageCandidates)) || firstPath(node, P.displayUrl);
    const versions = firstPath(node, P.videoVersions);
    const video = (Array.isArray(versions) && bestCandidateUrl(versions)) || firstPath(node, P.videoUrl);
    return { image, video };
  }

  function normalizeEmbedded(node) {
    const P = S.embedded.paths;
    const children =
      firstPath(node, P.carousel) || (firstPath(node, P.carouselEdges) || []).map((edge) => edge.node);
    const media = [];
    if (Array.isArray(children) && children.length) {
      for (const child of children) {
        const { image, video } = mediaFromNode(child);
        if (video) media.push({ type: "video", url: video, poster: image });
        else if (image) media.push({ type: "image", url: image });
      }
    } else {
      const { image, video } = mediaFromNode(node);
      if (video) {
        media.push({ type: "video", url: video });
        if (image) media.push({ type: "cover", url: image });
      } else if (image) {
        media.push({ type: "image", url: image });
      }
    }
    const code = firstPath(node, P.mediaType);
    const hasChildren = Array.isArray(children) && children.length > 0;
    return {
      caption: firstPath(node, P.caption),
      account: firstPath(node, P.account),
      date: U.toIso(firstPath(node, P.timestamp)),
      likes: parseCount(firstPath(node, P.likes)),
      comments: parseCount(firstPath(node, P.comments)),
      shares: parseCount(firstPath(node, P.shares)),
      views: parseCount(firstPath(node, P.views)),
      mediaType: hasChildren || code === S.embedded.mediaTypes.carousel
        ? "carousel"
        : media.some((m) => m.type === "video") ? "video" : "image",
      media
    };
  }

  function readEmbedded(doc, id) {
    const E = S.embedded;
    for (const script of doc.querySelectorAll(E.scripts)) {
      if (!script.textContent.includes(id)) continue;
      const json = U.safeJson(script.textContent);
      if (!json) continue;
      const node = U.deepFind(
        json,
        (n) => E.idKeys.some((k) => n[k] === id) && E.mediaMarkerKeys.some((k) => k in n),
        S.limits.embeddedNodeBudget
      );
      if (node) return normalizeEmbedded(node);
    }
    return null;
  }

  async function loadSources(id) {
    if (sourceCache.url === location.href && sourceCache.sources) return sourceCache.sources;
    const readAll = (doc) => {
      const meta = readMeta(doc, id);
      return { meta, ld: readJsonLd(doc, id, Boolean(meta)), embedded: readEmbedded(doc, id) };
    };
    const sources = readAll(document);
    // After in-app navigation the head and scripts still describe the old page,
    // so re-read this same URL once. Only happens on your click.
    if (!sources.embedded || (!sources.meta && !sources.ld)) {
      const fresh = await U.fetchFreshDocument();
      if (fresh) {
        const again = readAll(fresh);
        sources.meta = sources.meta || again.meta;
        sources.ld = sources.ld || again.ld;
        sources.embedded = sources.embedded || again.embedded;
      }
    }
    sourceCache = { url: location.href, sources };
    return sources;
  }

  /* ---------- live DOM readers ---------- */

  const findRoot = () => queryFirst(document, S.dom.roots) || document.body;

  function readCountsFromAria(root) {
    const out = {};
    for (const el of root.querySelectorAll("[aria-label]")) {
      const label = el.getAttribute("aria-label");
      for (const [name, pattern] of Object.entries(S.counts)) {
        const m = out[name] === undefined && label.match(pattern);
        if (m) out[name] = parseCount(m[1]);
      }
    }
    return out;
  }

  function readDom(root) {
    const out = { ...readCountsFromAria(root) };
    const caption = queryFirst(root, S.dom.caption);
    out.caption = caption ? caption.innerText.trim() : null;
    const account = queryFirst(root, S.dom.account);
    if (account) out.account = account.getAttribute("href").split("/").filter(Boolean)[0];
    const time = root.querySelector(S.dom.time);
    if (time) out.date = U.toIso(time.getAttribute("datetime"));
    for (const selector of S.dom.statsContainers) {
      for (const box of root.querySelectorAll(selector)) {
        const text = box.innerText || "";
        for (const [name, pattern] of Object.entries(S.counts)) {
          const m = out[name] === undefined && text.match(pattern);
          if (m) out[name] = parseCount(m[1]);
        }
      }
    }
    return out;
  }

  /** Earliest source wins unless a later one is a longer version of the same text. */
  function pickCaption(candidates) {
    const usable = candidates.filter((c) => typeof c === "string" && c.trim());
    if (!usable.length) return null;
    let chosen = usable[0];
    const stem = (t) => t.replace(/(\.\.\.|…)\s*$/, "").trim();
    for (const c of usable.slice(1)) {
      if (c.length > chosen.length && c.startsWith(stem(chosen))) chosen = c;
    }
    return chosen;
  }

  async function getPost() {
    const page = detectPageType();
    if (page.type !== "post") throw new PGError("This isn't an Instagram post or reel page.");
    const { meta, ld, embedded } = await loadSources(page.id);
    const m = meta || {}, l = ld || {}, e = embedded || {}, d = readDom(findRoot());
    const caption = pickCaption([m.caption, l.caption, e.caption, d.caption]);
    // Meta tags round large counts ("683K"), so structured data goes first for numbers.
    const stat = (name) => first(l[name], e[name], m[name], d[name]);
    const warnings = [];
    if (caption === null) warnings.push("Couldn't find caption, Instagram selectors may be outdated (selectors.js: instagram.meta / instagram.dom.caption).");
    const carouselHint = queryFirst(findRoot(), S.dom.carouselNext) || queryFirst(findRoot(), S.dom.carouselPrev);
    return {
      platform: "instagram",
      id: page.id,
      url: `https://www.instagram.com/${page.subtype === "reel" ? "reel" : "p"}/${page.id}/`,
      account: first(m.account, l.account, e.account, page.account, d.account),
      caption,
      hashtags: U.extractHashtags(caption),
      // m.date is last: the meta tag gives only a day, not a time.
      date: first(l.date, e.date, d.date, m.date),
      likes: stat("likes"),
      comments: stat("comments"),
      shares: stat("shares"),
      views: stat("views"),
      mediaType: first(e.mediaType, carouselHint ? "carousel" : null, page.subtype === "reel" || m.isVideo ? "video" : null, "image"),
      warnings
    };
  }

  /* ---------- media ---------- */

  function largestFromImg(img) {
    let best = img.currentSrc || img.src;
    let bestWidth = 0;
    for (const part of (img.getAttribute("srcset") || "").split(",")) {
      const [url, size] = part.trim().split(/\s+/);
      const width = parseInt(size, 10) || 0;
      if (url && width > bestWidth) {
        best = url;
        bestWidth = width;
      }
    }
    return best;
  }

  const isContentImage = (img) =>
    U.isHttpUrl(img.currentSrc || img.src) &&
    Math.max(img.naturalWidth, img.width) >= S.limits.minImagePx &&
    !/profile picture/i.test(img.alt || "");

  function imageKey(url) {
    try {
      return new URL(url).pathname;
    } catch (_) {
      return url;
    }
  }

  /** Last resort for carousels: step through slides the way you would by hand. */
  async function walkCarousel(root) {
    const found = new Map();
    const collect = () => {
      for (const img of root.querySelectorAll(S.dom.carouselImages)) {
        if (isContentImage(img)) {
          const url = largestFromImg(img);
          if (!found.has(imageKey(url))) found.set(imageKey(url), url);
        }
      }
    };
    collect();
    for (let i = 0; i < S.limits.carouselSteps; i++) {
      const next = queryFirst(root, S.dom.carouselNext);
      if (!next) break;
      next.click();
      await U.sleep(U.randInt(350, 700));
      collect();
    }
    return [...found.values()];
  }

  const NO_VIDEO_URL = "Instagram didn't expose a direct video URL on this page. The player is streaming it through a blob: address, so the video can't be saved.";

  async function getMediaUrls() {
    const page = detectPageType();
    if (page.type !== "post") throw new PGError("This isn't an Instagram post or reel page.");
    const { meta, ld, embedded } = await loadSources(page.id);
    if (embedded && embedded.media.length) return embedded.media;

    const m = meta || {}, l = ld || {};
    const root = findRoot();
    const media = [];
    const videoEl = root.querySelector(S.dom.video);
    const videoUrl = first(l.videos && l.videos[0], U.isHttpUrl(m.video) ? m.video : null, videoEl && U.isHttpUrl(videoEl.src) ? videoEl.src : null);
    const carousel = queryFirst(root, S.dom.carouselNext) || queryFirst(root, S.dom.carouselPrev);

    if (carousel) {
      const images = l.images && l.images.length > 1 ? l.images : await walkCarousel(root);
      if (!images.length) throw new PGError("Couldn't read the carousel images, Instagram selectors may be outdated (selectors.js: instagram.dom.carouselImages).");
      for (const url of images) media.push({ type: "image", url });
      if (videoEl) media.push({ type: "video", url: videoUrl, reason: NO_VIDEO_URL });
      return media;
    }

    if (videoEl || page.subtype === "reel" || m.isVideo || videoUrl) {
      media.push({ type: "video", url: videoUrl, reason: NO_VIDEO_URL });
      if (m.image) media.push({ type: "cover", url: m.image });
      return media;
    }

    const domImage = [...root.querySelectorAll(S.dom.images)].find(isContentImage);
    const image = first(l.images && l.images[0], domImage ? largestFromImg(domImage) : null, m.image);
    if (!image) throw new PGError("Couldn't find any image on this post, Instagram selectors may be outdated (selectors.js: instagram.dom.images).");
    media.push({ type: "image", url: image });
    return media;
  }

  /* ---------- profile grid ---------- */

  function numericTextNear(el) {
    let cur = el.parentElement;
    for (let i = 0; i < 4 && cur; i++, cur = cur.parentElement) {
      const n = parseCount(cur.innerText || cur.textContent);
      if (n !== null) return n;
    }
    return null;
  }

  function readTile(tile, tab) {
    const P = S.profile;
    const out = {};
    for (const svg of tile.querySelectorAll(P.icons)) {
      const label = svg.getAttribute("aria-label");
      for (const [name, pattern] of Object.entries(P.iconLabels)) {
        if (out[name] === undefined && pattern.test(label)) {
          const n = numericTextNear(svg);
          if (n !== null) out[name] = n;
        }
      }
    }
    const items = [...tile.querySelectorAll(P.overlayItems)].map((li) => parseCount(li.innerText || li.textContent));
    if (out.likes === undefined && items[0] !== undefined && items[0] !== null) out.likes = items[0];
    if (out.comments === undefined && items[1] !== undefined && items[1] !== null) out.comments = items[1];
    if (out.views === undefined && tab === "reels") {
      for (const leaf of tile.querySelectorAll(P.numericLeaves)) {
        if (leaf.children.length || leaf.closest("ul")) continue;
        const n = parseCount(leaf.textContent);
        if (n !== null) {
          out.views = n;
          break;
        }
      }
    }
    const aria = tile.getAttribute("aria-label") || "";
    for (const [name, pattern] of Object.entries(S.counts)) {
      const m = out[name] === undefined && aria.match(pattern);
      if (m) out[name] = parseCount(m[1]);
    }
    return out;
  }

  /** Grid likes/comments only render on hover, so hover at a slow pace and read locally. */
  async function readTileOnHover(tile, tab) {
    const fire = (type) => tile.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    fire("mouseover");
    fire("mouseenter");
    await U.sleep(U.randInt(120, 260));
    const metrics = readTile(tile, tab);
    fire("mouseout");
    fire("mouseleave");
    return metrics;
  }

  function readEmbeddedProfile() {
    const E = S.embedded;
    const byCode = new Map();
    for (const script of document.querySelectorAll(E.scripts)) {
      const text = script.textContent;
      if (!E.profileMarkers.some((marker) => text.includes(marker))) continue;
      const json = U.safeJson(text);
      if (!json) continue;
      const nodes = U.deepCollect(
        json,
        (n) => E.idKeys.some((k) => typeof n[k] === "string") && E.profileMarkers.some((k) => k in n),
        S.limits.embeddedNodeBudget
      );
      for (const node of nodes) {
        const code = E.idKeys.map((k) => node[k]).find(Boolean);
        if (!byCode.has(code)) byCode.set(code, normalizeEmbedded(node));
      }
    }
    return byCode;
  }

  async function getProfilePosts() {
    const page = detectPageType();
    if (page.type !== "profile") throw new PGError("This isn't an Instagram profile page.");
    if (profileCache.account !== page.account) profileCache = { account: page.account, posts: new Map() };
    const tiles = [...document.querySelectorAll(S.profile.tile)];
    if (!tiles.length && !profileCache.posts.size) {
      throw new PGError("Couldn't find any posts in the grid, Instagram selectors may be outdated (selectors.js: instagram.profile.tile). Private accounts and logged-out views can also show no posts.");
    }
    const embedded = readEmbeddedProfile();
    let hovers = 0;
    for (const tile of tiles) {
      const href = tile.getAttribute("href").match(S.profile.tileHref);
      if (!href) continue;
      const [, kind, code] = href;
      const previous = profileCache.posts.get(code);
      let metrics = readTile(tile, page.tab);
      const e = embedded.get(code) || {};
      const known = (n) => first(metrics[n], e[n], previous && previous[n]);
      if (known("likes") === null && hovers < S.limits.hoverPerRun) {
        hovers++;
        metrics = { ...metrics, ...(await readTileOnHover(tile, page.tab)) };
      }
      const img = tile.querySelector(S.profile.thumbnail);
      profileCache.posts.set(code, {
        platform: "instagram",
        id: code,
        url: `https://www.instagram.com/${kind}/${code}/`,
        account: page.account,
        thumbnail: first(img && (img.currentSrc || img.src), previous && previous.thumbnail),
        caption: first(e.caption, img && img.alt, previous && previous.caption),
        views: known("views"),
        likes: known("likes"),
        comments: known("comments")
      });
    }
    return [...profileCache.posts.values()];
  }

  return { detectPageType, getPost, getProfilePosts, getMediaUrls };
})();
