export function getServerBase(): string {
  const explicit = (import.meta.env as any).VITE_SERVER_BASE_URL as string | undefined;
  if (explicit) {
    try {
      const u = new URL(explicit, window.location.origin);
      return `${u.origin}${u.pathname}`.replace(/\/$/, '');
    } catch { /* fallthrough */ }
  }
  const httpUrl = (import.meta.env as any).VITE_GRAPHQL_URL as string | undefined;
  const wsUrl = (import.meta.env as any).VITE_GRAPHQL_WS_URL as string | undefined;

  // Prefer explicit HTTP URL if provided
  let raw = httpUrl || '';
  // If only WS URL is set, convert it to HTTP(S)
  if ((!raw || !/^https?:/i.test(raw)) && wsUrl && /^wss?:/i.test(wsUrl)) {
    raw = wsUrl.replace(/^ws/i, 'http');
  }

  if (!raw) return '';
  try {
    const u = new URL(raw, window.location.origin);
    // Strip trailing /graphql if present
    u.pathname = u.pathname.replace(/\/?graphql$/, '');
    return `${u.origin}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return '';
  }
}
