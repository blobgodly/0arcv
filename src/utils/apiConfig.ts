/**
 * API Configuration Helper
 * Provides universal base URL resolution across Web and Native iOS (Capacitor) environments.
 * Ensures data always routes to the persistent MongoDB backend server.
 */

const STORAGE_SERVER_KEY = '0arc_custom_server_url';

export function getCustomServerUrl(): string {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_SERVER_KEY);
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
    }
  }
  return '';
}

export function setCustomServerUrl(url: string): void {
  if (typeof localStorage !== 'undefined') {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (trimmed) {
      localStorage.setItem(STORAGE_SERVER_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_SERVER_KEY);
    }
  }
}

export function getApiBaseUrl(): string {
  // 1. User-configured custom server URL
  const custom = getCustomServerUrl();
  if (custom) return custom;

  // 2. Build-time environment variable (e.g. from GitHub Actions secret / VITE_API_URL)
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (typeof envUrl === 'string' && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 3. Fallback: If on Web, use relative path (''). If inside Capacitor iOS, return empty by default
  return '';
}

export function getApiUrl(path: string): string {
  const base = getApiBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${cleanPath}` : cleanPath;
}
