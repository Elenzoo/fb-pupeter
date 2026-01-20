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

// Wykrycie do zatwierdzenia (przyszłość)
export interface Discovery {
  id: string
  sourceId: string
  postUrl: string
  content: string
  status: 'pending' | 'approved' | 'rejected'
  matchedKeywords: string[]
  discoveredAt: string
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
