/* Small UI helpers shared by the popup, side panel and settings page. */
self.PG = self.PG || {};

self.PG.ui = (function () {
  const $ = (selector, root = document) => root.querySelector(selector);

  function setStatus(el, message, kind = "info") {
    el.textContent = message || "";
    el.dataset.kind = kind;
    el.hidden = !message;
  }

  const formatCount = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("en-US"));

  function formatCompact(n) {
    if (n === null || n === undefined) return "–";
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  }

  function engagementRate(post) {
    if (!post.views || post.likes === null || post.likes === undefined) return null;
    return (post.likes + (post.comments || 0)) / post.views;
  }

  const formatPercent = (r) => (r === null ? "–" : (r * 100).toFixed(2) + "%");

  /** Saves text through the service worker; very large files go by blob URL. */
  async function saveText(filename, text, mime = "text/plain") {
    const encoded = encodeURIComponent(text);
    const url =
      encoded.length < 1800000
        ? `data:${mime};charset=utf-8,${encoded}`
        : URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    await self.PG.utils.sendToBackground({ type: "DOWNLOAD_URL", url, filename });
  }

  return { $, setStatus, formatCount, formatCompact, engagementRate, formatPercent, saveText };
})();
