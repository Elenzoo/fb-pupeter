// Post monitorowany
export interface Post {
  id: string
  url: string
  active: boolean
  name: string
  image: string
  description: string
  createdAt: string
  updatedAt: string
}

// Status systemu
export interface SystemStatus {
  ok: boolean
  projectDir: string
  envPath: string
  cookiesPath: string
  postsPath: string
  node: string
  pm2: string
  pm2Status: string
  time: string
}

// Ustawienia .env
export interface EnvValues {
  // Facebook
  FB_EMAIL: string
  FB_PASSWORD: string
  // Watcher
  CHECK_INTERVAL_MS: string
  FAST_MODE: string
  INCLUDE_REPLIES: string
  // Logi
  LOG_LEVEL: string
  // Puppeteer
  HEADLESS_BROWSER: string
  USE_UI_HANDLERS: string
  COOKIES_READ_ONLY: string
  // Źródła postów
  POSTS_SHEET_URL: string
  POSTS_API_URL: string
  POSTS_API_TOKEN: string
  // Telegram Owner
  TELEGRAM_SEND_TO_OWNER: string
  TELEGRAM_BOT_TOKEN_OWNER: string
  TELEGRAM_CHAT_ID_OWNER: string
  // Telegram Client
  TELEGRAM_SEND_TO_CLIENT: string
  TELEGRAM_BOT_TOKEN_CLIENT: string
  TELEGRAM_CHAT_ID_CLIENT: string
  // Telegram Format
  TELEGRAM_USE_PHOTO: string
  TELEGRAM_DISABLE_WEB_PAGE_PREVIEW: string
  // Telegram Alerty
  TG_ALERTS_ENABLED: string
  TG_ALERTS_COOLDOWN_SEC: string
  TG_ALERTS_MAXLEN: string
  // Legacy
  WEBHOOK_URL: string
  // LITE: Session Management
  SESSION_LENGTH_MIN_MS: string
  SESSION_LENGTH_MAX_MS: string
  WARMUP_ENABLED: string
  WARMUP_DURATION_MIN_MS: string
  WARMUP_DURATION_MAX_MS: string
  // LITE: Anti-Detection
  VIEWPORT_RANDOMIZATION: string
  TYPING_MISTAKES_ENABLED: string
  TYPING_MISTAKES_CHANCE: string
  NAVIGATION_MISTAKES_ENABLED: string
  PROFILE_VISITS_ENABLED: string
  PROFILE_VISITS_CHANCE: string
  TAB_SIMULATION_ENABLED: string
  TAB_SIMULATION_CHANCE: string
  IMAGE_INTERACTION_ENABLED: string
  IMAGE_INTERACTION_CHANCE: string
  // LITE: Night Mode
  NIGHT_MODE_ENABLED: string
  NIGHT_START_HOUR: string
  NIGHT_END_HOUR: string
  NIGHT_CATCHUP_HOURS: string
  // LITE: Feed Scanner
  FEED_SCAN_ENABLED: string
  FEED_SCAN_KEYWORDS: string
  FEED_SCROLL_DURATION_MIN: string
  FEED_SCROLL_DURATION_MAX: string
  // LITE: Human Behavior
  HUMAN_MODE: string
  HUMAN_RANDOM_LIKE_CHANCE: string
  DISCOVERY_TELEGRAM_ENABLED: string
  WEBHOOK_MAX_AGE_MIN: string
  // LITE: Between Posts Pause
  BETWEEN_POSTS_PAUSE_MIN_MS: string
  BETWEEN_POSTS_PAUSE_MAX_MS: string
}

// Status sesji cookies
export interface SessionStatus {
  mainCookiesExists: boolean
  mainCookiesAge?: number
  mainCookiesSize?: number
  isLoggedIn?: boolean
}

// Źródło monitorowania (przyszłość)
export interface Source {
  id: string
  type: 'home_feed' | 'group' | 'meta_ads'
  name: string
  keywords: string[]
  active: boolean
  groupUrl?: string
}

// Wykrycie do zatwierdzenia
export interface Discovery {
  id: string
  url: string
  content: string
  pageName?: string
  matchedKeywords: string[]
  source: 'home_feed' | 'group' | 'meta_ads'
  discoveredAt: string
  status: 'pending' | 'approved' | 'rejected'
}

// Wpis na blacklist
export interface BlacklistEntry {
  id: string
  url: string
  reason: 'user_rejected' | 'manual'
  rejectedAt: string
  content?: string
  pageName?: string
}

// API Response types
export interface ApiResponse<T = unknown> {
  ok: boolean
  error?: string
  data?: T
}

export interface PostsResponse {
  ok: boolean
  posts: Post[]
  error?: string
}

export interface EnvResponse {
  ok: boolean
  values: EnvValues
  error?: string
}

export interface LogsResponse {
  ok: boolean
  log?: string
  path?: string
  error?: string
  source?: string
}

export interface DiscoveriesResponse {
  ok: boolean
  discoveries: Discovery[]
  total: number
  error?: string
}

export interface BlacklistResponse {
  ok: boolean
  blacklist: BlacklistEntry[]
  total: number
  error?: string
}
