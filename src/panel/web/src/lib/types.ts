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

// Keywords dla Feed Scannera
export interface KeywordEntry {
  text: string
  enabled: boolean
}

export interface KeywordsData {
  keywords: KeywordEntry[]
  enabled: boolean
}

export interface KeywordsResponse {
  ok: boolean
  keywords: KeywordEntry[]
  enabled: boolean
  error?: string
}

// Statystyki per post (przechowywane w cache)
export interface PostStats {
  totalDetected: number
  firstSeenAt: string
  lastSeenAt: string
  lastNewCommentAt: string | null
  lastNewCommentAge: string | null
  // Nowe pola - rzeczywisty czas komentarza z FB
  lastCommentTime: string | null
  lastCommentAge: string | null
}

// Post z wyliczonym tier i statystykami
export type PostTier = 'hot' | 'active' | 'weak' | 'dead'

export interface PostWithStats extends Post {
  stats?: PostStats
  tier: PostTier
  daysSinceLastComment: number | null
  lastCommentAge: string | null
  lastCommentSource: 'fb' | 'bot' | null
}

// Martwy post
export interface DeadPost {
  id: string
  url: string
  name: string
  lastCommentAgeDays: number
  movedAt: string
  totalDetectedBeforeDeath: number
  reason: 'no_activity_14_days' | 'manual'
}

// Globalne statystyki
export interface GlobalStats {
  totalCommentsSent: number
  cyclesCompleted: number
  startedAt: string
  lastCycleAt: string
}

// Statystyki dzienne
export interface DailyStats {
  [date: string]: {
    comments: number
    cycles: number
  }
}

// Response z /api/stats
export interface StatsResponse {
  ok: boolean
  summary: {
    totalPosts: number
    activePosts: number
    deadPosts: number
    totalComments: number
    lastCycleAt: string | null
    cyclesCompleted: number
    // Info o sesji
    startedAt: string | null
    lastSessionStart: string | null
    restartCount: number
  }
  posts: PostWithStats[]
  daily: DailyStats
  error?: string
}

// Response z /api/dead-posts
export interface DeadPostsResponse {
  ok: boolean
  deadPosts: DeadPost[]
  total: number
  error?: string
}

// ==================== MARKETPLACE ====================

// Kategoria w puli treści
export interface MarketplaceCategory {
  id: string
  name: string
  active: boolean
  titles: string[]
  descriptions: string[]
  prices: {
    min: number
    max: number
  }
  images: string[]
  location?: {
    city: string
    radius_km: number
  }
  fbCategory?: string
}

// Pula treści Marketplace
export interface MarketplaceContentPool {
  categories: MarketplaceCategory[]
  settings: {
    imagesPerListing: {
      min: number
      max: number
    }
    publishHours: number[]
    avoidWeekends: boolean
  }
}

// Opublikowane ogłoszenie
export interface MarketplaceListing {
  id: string
  fbListingId?: string
  categoryId: string
  title: string
  price: number
  publishedAt: string
  lastRenewedAt: string | null
  nextRenewalDue: string
  status: 'active' | 'expired' | 'deleted' | 'blocked'
}

// Wpis w logu wznowień
export interface MarketplaceRenewalLog {
  timestamp: string
  listingId: string
  success: boolean
  title?: string
  error?: string
}

// Losowa treść z puli
export interface MarketplaceRandomContent {
  categoryId: string
  categoryName: string
  title: string
  description: string
  price: number
  images: string[]
  location?: {
    city: string
    radius_km: number
  }
  fbCategory?: string
}

// Stan schedulera
export interface MarketplaceSchedulerState {
  isRunning: boolean
  lastCheck: string | null
  lastRenewalRun: string | null
  lastPublishRun: string | null
  consecutiveErrors: number
  stopped: boolean
  stoppedReason: string | null
}

// Konfiguracja schedulera
export interface MarketplaceConfig {
  renewalIntervalDays: number
  renewalCheckHours: number[]
  publishIntervalDays: number
  maxActiveListings: number
  maxErrors: number
}

// Statystyki puli i ogłoszeń
export interface MarketplaceStats {
  pool: {
    totalCategories: number
    activeCategories: number
    totalTitles: number
    totalDescriptions: number
    totalImages: number
  }
  listings: {
    total: number
    active: number
    needingRenewal: number
    totalPublished: number
    totalRenewed: number
    lastPublishedAt: string | null
    lastRenewedAt: string | null
  }
}

// Response z /api/marketplace/status
export interface MarketplaceStatusResponse {
  ok: boolean
  enabled: boolean
  state: MarketplaceSchedulerState
  config: MarketplaceConfig
  stats: MarketplaceStats
  nextActions: {
    shouldRenew: boolean
    shouldPublish: boolean
    listingsNeedingRenewal: number
  }
  error?: string
}

// Response z /api/marketplace/listings
export interface MarketplaceListingsResponse {
  ok: boolean
  listings: MarketplaceListing[]
  error?: string
}

// Response z /api/marketplace/content-pool
export interface MarketplaceContentPoolResponse {
  ok: boolean
  pool: MarketplaceContentPool
  error?: string
}

// Response z /api/marketplace/renewals
export interface MarketplaceRenewalsResponse {
  ok: boolean
  log: MarketplaceRenewalLog[]
  stats: {
    totalRenewals: number
    successfulRenewals: number
    failedRenewals: number
  }
  error?: string
}

// Response z /api/marketplace/random-content
export interface MarketplaceRandomContentResponse {
  ok: boolean
  content?: MarketplaceRandomContent
  error?: string
}

// Response z akcji manual renew/publish
export interface MarketplaceActionResponse {
  ok: boolean
  result?: {
    success?: boolean
    renewed?: number
    failed?: number
    listing?: MarketplaceListing
    error?: string
  }
  error?: string
}
