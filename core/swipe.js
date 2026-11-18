/* Research notes ("swipe file") in chrome.storage.local. */
self.PG = self.PG || {};

self.PG.swipe = (function () {
  const KEY = "swipeFile";
  const keyFor = (post) => `${post.platform}:${post.id}`;

  async function all() {
    const stored = await chrome.storage.local.get(KEY);
    return stored[KEY] || [];
  }

  async function find(post) {
    return (await all()).find((e) => e.key === keyFor(post)) || null;
  }

  /** Saves a post with notes. Saving the same post again updates it. */
  async function save(post, notes) {
    const entries = await all();
    const key = keyFor(post);
    const existing = entries.find((e) => e.key === key);
    const entry = {
      key,
      savedAt: existing ? existing.savedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      platform: post.platform,
      id: post.id,
      url: post.url,
      account: post.account,
      date: post.date,
      caption: post.caption,
      hashtags: post.hashtags,
      likes: post.likes,
      comments: post.comments,
      shares: post.shares,
      views: post.views,
      hookType: notes.hookType || "",
      format: notes.format || "",
      tags: notes.tags || "",
      notes: notes.notes || ""
    };
    const next = existing ? entries.map((e) => (e.key === key ? entry : e)) : [entry, ...entries];
    await chrome.storage.local.set({ [KEY]: next });
    return { entry, updated: Boolean(existing), total: next.length };
  }

  async function remove(key) {
    const next = (await all()).filter((e) => e.key !== key);
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  }

  const COLUMNS = [
    ["saved_at", "savedAt"], ["platform", "platform"], ["account", "account"], ["url", "url"],
    ["post_date", "date"], ["hook_type", "hookType"], ["format", "format"], ["tags", "tags"],
    ["notes", "notes"], ["views", "views"], ["likes", "likes"], ["comments", "comments"],
    ["shares", "shares"], ["caption", "caption"]
  ].map(([header, field]) => ({ header, value: (row) => row[field] }));

  const toCsv = (entries) => self.PG.csv.build(entries, COLUMNS);

  return { all, find, save, remove, toCsv };
})();
