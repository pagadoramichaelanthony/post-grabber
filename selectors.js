/*
 * selectors.js: every site-specific selector, regex and JSON path lives here.
 * When a site changes, this is normally the only file you need to edit.
 * See "Updating selectors" in README.md.
 *
 * Lists are tried in order; the first one that yields a value wins.
 * JSON paths are dotted strings ("stats.playCount"); numbers index arrays.
 */
self.PG_SELECTORS = {
  /* ===================================================== INSTAGRAM ===== */
  instagram: {
    displayName: "Instagram",
    hostPattern: /(^|\.)instagram\.com$/i,

    // How files are fetched, in order. "direct" = chrome.downloads,
    // "page" = fetch inside the page (content script).
    download: { video: ["direct"], image: ["direct"] },

    url: {
      // /p/CODE/, /reel/CODE/, /reels/CODE/, /username/p/CODE/, /username/reel/CODE/
      post: /^\/(?:([A-Za-z0-9._]+)\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?/,
      // /username/, /username/reels/, /username/tagged/
      profile: /^\/([A-Za-z0-9._]+)\/?(?:(reels|tagged|saved)\/?)?$/,
      reservedNames: [
        "explore", "accounts", "direct", "reels", "stories", "p", "reel", "tv",
        "about", "developer", "legal", "challenge", "emails", "web", "api", "graphql"
      ]
    },

    meta: {
      ogUrl: 'meta[property="og:url"]',
      ogTitle: 'meta[property="og:title"]',
      ogDescription: 'meta[property="og:description"]',
      description: 'meta[name="description"]',
      ogImage: 'meta[property="og:image"]',
      ogVideo: ['meta[property="og:video:secure_url"]', 'meta[property="og:video"]'],
      ogType: 'meta[property="og:type"]'
    },

    // Text formats Instagram uses inside the meta tags (English UI).
    metaParsers: {
      // 1,234 likes, 56 comments - someuser on March 3, 2025: "the caption".
      description: /^\s*([\d.,]+\s*[KMB]?)\s+likes?,\s*([\d.,]+\s*[KMB]?)\s+comments?\s*-\s*([A-Za-z0-9._]+)\s+on\s+([^:]+?):\s*["“]([\s\S]*?)["”]\.?\s*$/i,
      // Display Name on Instagram: "the caption"
      title: /^.*?\son Instagram:\s*["“]([\s\S]*?)["”]\s*$/i,
      titleAccount: /\(@([A-Za-z0-9._]+)\)/
    },

    jsonLd: {
      scripts: 'script[type="application/ld+json"]',
      caption: ["articleBody", "caption", "description"],
      account: ["author.alternateName", "author.identifier.value", "author.name"],
      date: ["dateCreated", "uploadDate", "datePublished"],
      url: ["url", "mainEntityOfPage.@id", "identifier.value"],
      statTypes: { likes: /LikeAction/i, comments: /CommentAction/i, views: /WatchAction/i, shares: /ShareAction/i }
    },

    // JSON blobs Instagram embeds in the HTML. These are the only on-page
    // source that lists every carousel item, so they are used for media.
    embedded: {
      scripts: 'script[type="application/json"]',
      idKeys: ["code", "shortcode"],
      mediaMarkerKeys: ["image_versions2", "carousel_media", "video_versions", "display_url", "edge_sidecar_to_children"],
      profileMarkers: ["like_count", "edge_media_preview_like", "play_count", "view_count"],
      paths: {
        caption: ["caption.text", "edge_media_to_caption.edges.0.node.text"],
        account: ["user.username", "owner.username"],
        timestamp: ["taken_at", "taken_at_timestamp"],
        likes: ["like_count", "edge_media_preview_like.count", "edge_liked_by.count"],
        comments: ["comment_count", "edge_media_to_comment.count", "edge_media_preview_comment.count"],
        shares: ["share_count", "reshare_count"],
        views: ["play_count", "ig_play_count", "view_count", "video_play_count", "video_view_count"],
        mediaType: ["media_type"],
        carousel: ["carousel_media"],
        carouselEdges: ["edge_sidecar_to_children.edges"],
        imageCandidates: ["image_versions2.candidates"],
        displayUrl: ["display_url"],
        videoVersions: ["video_versions"],
        videoUrl: ["video_url"]
      },
      mediaTypes: { image: 1, video: 2, carousel: 8 }
    },

    dom: {
      // Modal first: opening a post from a profile overlays the grid.
      roots: ['div[role="dialog"] article', 'div[role="dialog"]', "main article", "article", "main"],
      caption: ['h1[dir="auto"]', "h1", 'ul li span[dir="auto"]'],
      account: ['header a[href^="/"]:not([href*="/explore/"])', 'a[role="link"][href^="/"]'],
      time: "time[datetime]",
      statsContainers: ["section", "footer"],
      carouselNext: ['button[aria-label="Next"]', 'div[role="button"][aria-label="Next"]'],
      carouselPrev: ['button[aria-label="Go back"]', 'button[aria-label="Previous"]'],
      carouselImages: "ul li img",
      images: "img",
      video: "video"
    },

    // Count patterns for aria-labels and visible text (English UI).
    counts: {
      likes: /([\d.,]+\s*[KMB]?)\s+(?:likes?|others)\b/i,
      comments: /([\d.,]+\s*[KMB]?)\s+comments?\b/i,
      views: /([\d.,]+\s*[KMB]?)\s+(?:views?|plays?)\b/i,
      shares: /([\d.,]+\s*[KMB]?)\s+shares?\b/i
    },

    profile: {
      tile: 'main a[href*="/p/"], main a[href*="/reel/"]',
      tileHref: /\/(p|reel)\/([A-Za-z0-9_-]+)/,
      thumbnail: "img",
      iconLabels: { views: /view|play/i, likes: /like|heart/i, comments: /comment/i },
      icons: "svg[aria-label]",
      overlayItems: "ul li",
      numericLeaves: "span, div"
    },

    limits: {
      carouselSteps: 20,      // max "Next" clicks when walking a carousel
      minImagePx: 300,        // ignores avatars and icons
      hoverPerRun: 60,        // max grid tiles hovered per collection
      embeddedNodeBudget: 400000
    }
  },

  /* ======================================================== TIKTOK ===== */
  tiktok: {
    displayName: "TikTok",
    hostPattern: /(^|\.)tiktok\.com$/i,

    // TikTok video URLs may need the page's cookies/referer, so try in-page first.
    // Images go direct: repeated in-page saves trigger Chrome's "multiple downloads" prompt.
    download: { video: ["page", "direct"], image: ["direct", "page"] },

    url: {
      post: /^\/@([^/]+)\/(video|photo)\/(\d+)/,
      profile: /^\/@([^/]+)\/?$/
    },

    scripts: [
      { name: "__UNIVERSAL_DATA_FOR_REHYDRATION__", selector: "script#__UNIVERSAL_DATA_FOR_REHYDRATION__" },
      { name: "SIGI_STATE", selector: "script#SIGI_STATE" },
      { name: "sigi-persisted-data", selector: "script#sigi-persisted-data" },
      { name: "__NEXT_DATA__", selector: "script#__NEXT_DATA__" }
    ],

    // Known item locations; {id} is the post ID. If all miss, the JSON is searched.
    itemPaths: [
      "__DEFAULT_SCOPE__.webapp.video-detail.itemInfo.itemStruct",
      "ItemModule.{id}",
      "props.pageProps.itemInfo.itemStruct"
    ],

    paths: {
      id: ["id"],
      caption: ["desc", "contents.0.desc"],
      account: ["author.uniqueId", "author", "authorInfo.uniqueId"],
      createTime: ["createTime"],
      likes: ["stats.diggCount", "statsV2.diggCount"],
      comments: ["stats.commentCount", "statsV2.commentCount"],
      shares: ["stats.shareCount", "statsV2.shareCount"],
      views: ["stats.playCount", "statsV2.playCount"],
      images: ["imagePost.images"],
      imageUrl: ["imageURL.urlList.0", "displayImage.urlList.0", "imageURL.urlList.1"],
      videoUrls: ["video.playAddr", "video.downloadAddr"],
      bitrates: ["video.bitrateInfo"],
      bitrateUrls: ["PlayAddr.UrlList"],
      cover: ["video.originCover", "video.cover", "video.dynamicCover", "imagePost.cover.imageURL.urlList.0"],
      thumbnail: ["video.cover", "video.originCover", "imagePost.cover.imageURL.urlList.0"]
    },

    dom: {
      caption: ['[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]', 'h1[data-e2e="video-desc"]'],
      account: ['[data-e2e="browse-username"]', '[data-e2e="video-author-uniqueid"]'],
      likes: ['[data-e2e="browse-like-count"]', '[data-e2e="like-count"]'],
      comments: ['[data-e2e="browse-comment-count"]', '[data-e2e="comment-count"]'],
      shares: ['[data-e2e="share-count"]', '[data-e2e="browse-share-count"]'],
      views: ['[data-e2e="video-views"]'],
      photoImages: '[class*="PhotoVideoContainer"] img, .swiper-slide img, [data-e2e="browse-video"] img',
      video: "video",
      videoSource: "video source"
    },

    profile: {
      tile: '[data-e2e="user-post-item"], [data-e2e="user-post-item-list"] > div',
      link: 'a[href*="/video/"], a[href*="/photo/"]',
      linkId: /\/@([^/]+)\/(video|photo)\/(\d+)/,
      views: '[data-e2e="video-views"]',
      thumbnail: "img"
    },

    limits: { minImagePx: 200, embeddedNodeBudget: 400000 }
  }
};
