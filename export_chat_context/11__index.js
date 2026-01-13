// src/fb/ui/index.js
import * as PostUI from "./post.js";
import * as PhotoUI from "./photo.js";
import * as WatchUI from "./watch.js";
import * as VideosUI from "./videos.js";

const HANDLERS = [WatchUI, VideosUI, PhotoUI, PostUI];

export function pickUiHandler(url) {
  const u = String(url || "");
  for (const h of HANDLERS) {
    try {
      if (h.matchesUrl(u)) return h;
    } catch {}
  }
  return PostUI;
}
