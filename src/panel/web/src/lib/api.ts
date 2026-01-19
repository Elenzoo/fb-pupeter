import type {
  SystemStatus,
  PostsResponse,
  EnvResponse,
  LogsResponse,
  Post,
  SessionStatus,
} from './types'

const TOKEN_KEY = 'FBW_PANEL_TOKEN'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

function getAuthHeaders(): HeadersInit {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T & { ok: boolean; error?: string }> {
  const headers: Record<string, string> = {
    ...(getAuthHeaders() as Record<string, string>),
    ...((options.headers || {}) as Record<string, string>),
  }

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(options.body)
  }

  try {
    const res = await fetch(path, {
      ...options,
      headers,
    })

    const text = await res.text()
    let data: T & { ok: boolean; error?: string }

    try {
      data = JSON.parse(text)
    } catch {
      data = { ok: false, error: text || `HTTP ${res.status}` } as T & { ok: boolean; error?: string }
    }

    if (!res.ok && data.ok !== false) {
      data.ok = false
      data.error = data.error || `HTTP ${res.status}`
    }

    return data
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' } as T & { ok: boolean; error?: string }
  }
}

// Status
export async function getStatus(): Promise<SystemStatus & { ok: boolean; error?: string }> {
  return request<SystemStatus>('/api/status')
}

// Env
export async function getEnv(): Promise<EnvResponse> {
  return request<EnvResponse>('/api/env/get')
}

export async function setEnv(set: Record<string, string>, restart = false): Promise<{ ok: boolean; error?: string }> {
  return request('/api/env/set', {
    method: 'POST',
    body: JSON.stringify({ set, restart }),
  })
}

// Posts
export async function getPosts(): Promise<PostsResponse> {
  return request<PostsResponse>('/api/posts')
}

export async function addPost(post: Partial<Post>): Promise<{ ok: boolean; post?: Post; error?: string }> {
  return request('/api/posts', {
    method: 'POST',
    body: JSON.stringify(post),
  })
}

export async function updatePost(id: string, data: Partial<Post>): Promise<{ ok: boolean; post?: Post; error?: string }> {
  return request(`/api/posts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function deletePost(id: string): Promise<{ ok: boolean; error?: string }> {
  return request(`/api/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// PM2
export async function pm2Start(): Promise<{ ok: boolean; output?: string; error?: string }> {
  return request('/api/pm2/start', { method: 'POST' })
}

export async function pm2Stop(): Promise<{ ok: boolean; output?: string; error?: string }> {
  return request('/api/pm2/stop', { method: 'POST' })
}

export async function pm2Restart(): Promise<{ ok: boolean; output?: string; error?: string }> {
  return request('/api/pm2/restart', { method: 'POST' })
}

export async function pm2Status(): Promise<{ ok: boolean; output?: string; error?: string }> {
  return request('/api/pm2/status')
}

// Logs
export async function getLogsOut(lines = 200): Promise<LogsResponse> {
  return request<LogsResponse>(`/api/logs/out?lines=${lines}`)
}

export async function getLogsErr(lines = 200): Promise<LogsResponse> {
  return request<LogsResponse>(`/api/logs/err?lines=${lines}`)
}

// Cookies
export async function clearCookies(): Promise<{ ok: boolean; error?: string }> {
  return request('/api/cookies/clear', {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  })
}

export async function getCookiesStatus(): Promise<SessionStatus & { ok: boolean; error?: string }> {
  return request<SessionStatus>('/api/cookies/status')
}

export async function getCookiesBackups(): Promise<{ ok: boolean; backups: SessionStatus['backups']; error?: string }> {
  return request('/api/cookies/backups')
}

export async function activateCookiesBackup(index: number): Promise<{ ok: boolean; error?: string }> {
  return request(`/api/cookies/activate/${index}`, { method: 'POST' })
}

export async function restoreCookiesBackup(index: number): Promise<{ ok: boolean; restoredIndex?: number; error?: string }> {
  return request(`/api/cookies/restore/${index}`, { method: 'POST' })
}

export async function createCookiesBackup(): Promise<{ ok: boolean; savedIndex?: number; error?: string }> {
  return request('/api/cookies/backup', { method: 'POST' })
}

export async function deleteCookiesBackup(index: number): Promise<{ ok: boolean; error?: string }> {
  return request(`/api/cookies/backup/${index}`, { method: 'DELETE' })
}
