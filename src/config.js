import "dotenv/config";

// FB_POST_URLS = url1,url2,url3
function getPostsFromEnv() {
  const raw = process.env.FB_POST_URLS || "";
  const urls = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return urls.map((url, index) => ({
    id: `post${index + 1}`,
    url,
  }));
}

// FB_POST_LABELS = nazwa1,nazwa2,nazwa3 (opcjonalnie)
function getPostLabelsFromEnv(posts) {
  const raw = process.env.FB_POST_LABELS || "";
  const labels = raw.split(",").map((s) => s.trim());

  const map = {};
  posts.forEach((post, idx) => {
    map[post.id] = labels[idx] || post.id;
  });
  return map;
}

const POSTS = getPostsFromEnv();

if (!POSTS.length) {
  console.error(
    "[CONFIG] Brak postów do monitorowania. Ustaw FB_POST_URLS w .env (lista URL, oddzielone przecinkami)."
  );
  process.exit(1);
}

const POST_LABELS = getPostLabelsFromEnv(POSTS);

// EXPAND_COMMENTS=false → tylko licznik
const EXPAND_COMMENTS =
  process.env.EXPAND_COMMENTS === "false" ? false : true;

const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60000);

export { POSTS, POST_LABELS, EXPAND_COMMENTS, CHECK_INTERVAL_MS };
