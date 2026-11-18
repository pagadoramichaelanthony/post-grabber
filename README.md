# Post Grabber

A Chrome extension (Manifest V3) for social media content research on Instagram and TikTok. It reads the post or profile you're viewing, saves captions, stats and media, ranks a profile's posts by performance, and keeps a "swipe file" of posts with your own notes. Plain JavaScript, no build step.

> **Use responsibly.** Automated collection may violate Instagram's and TikTok's terms of service, and saved media remains the creator's copyright. Use it at a human pace for your own research, and don't republish what you collect.

## Features

**Post pages (popup)**
- **Copy caption** with hashtags.
- **Save images** from carousels and photo posts as `Downloads/account_postID/01.jpg`, `02.jpg`, … (the cover on video posts).
- **Save video** when the page exposes a direct file URL.
- **Export all**: a `post.txt` with caption, URL, account, date, likes, comments, shares and views, plus all available media.
- **Get transcript** (optional) via OpenAI Whisper using your own API key.
- **Save to swipe file** with hook type, format, tags and notes.

**Profile pages (side panel)**
- **Rank posts** already loaded on the page, sorted by views (then likes).
- **Load more** scrolls one screen per click with a short random pause; it never loops.
- Engagement column: `(likes + comments) / views`.
- **Top 10**, **Export selected** (CSV) and **Grab selected** (runs Export all on each post with a capped, randomized delay; **Stop** ends it).

**Settings**
- Per-run post cap (default 30) and delay range (default 4–9 s).
- Transcript toggle and API key.
- Swipe file viewer with CSV export.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (116 or newer).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.
5. Pin Post Grabber from the puzzle-piece menu.
6. Reload any Instagram or TikTok tabs that were already open.

## Usage

1. Open an Instagram or TikTok **post** and click the toolbar icon to copy, save or export it.
2. On a **profile**, click the icon, choose **Open side panel to rank posts**, then **Rank posts**. Use **Load more** to add posts, select rows, then export or grab them.
3. To enable transcripts, open **Settings**, tick **Enable Get transcript**, paste your OpenAI API key and save.

## Notes

- **Acts only on click**, on the tab you're viewing. No background crawling, no login automation, and it never reads cookies or tokens.
- **Selectors break when sites change.** All site-specific selectors and JSON paths live in `selectors.js`, one section per platform. Instagram parsing assumes the English UI.
- **Video saves aren't always possible.** Many Instagram players stream via `blob:` URLs with no downloadable file. Signed media links can also expire (HTTP 403); reload the page and retry.
- **Grid stats vary by site.** TikTok grids usually show views but not likes; Instagram's Reels tab shows views, while the main grid shows likes and comments on hover.
- **Transcripts** send the video file to OpenAI's `whisper-1` (25 MB max) and are billed to your key. The key is stored only in `chrome.storage.local`, hidden from content scripts, and sent only to `api.openai.com`.
- Chrome may ask to allow multiple downloads per site; turn off "Ask where to save each file" to avoid a dialog per file.

## Project structure

```
manifest.json     Permissions and entry points
selectors.js      Site-specific selectors and JSON paths
background.js     Service worker: save and transcript jobs
content.js        Message handler inside the site tab
adapters/         instagram.js, tiktok.js (shared interface)
core/             Shared utilities, settings, CSV, downloads, transcript
popup/            Post page UI
sidepanel/        Profile ranking UI
options/          Settings and swipe file
icons/            Extension icons
```

To add a platform: add a section to `selectors.js`, an adapter exposing `detectPageType()`, `getPost()`, `getProfilePosts()` and `getMediaUrls()`, and a `content_scripts` entry in `manifest.json`.

## License

[MIT](LICENSE) © Michael Anthony Pagadora
