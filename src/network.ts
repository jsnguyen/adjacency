export function resolveApiUrl(path: string): string {
  const configuredUrl = import.meta.env.VITE_ADJACENCY_API_URL as string | undefined;
  if (configuredUrl) {
    return new URL(path, new URL(configuredUrl, window.location.href)).toString();
  }

  const origin = isViteDevServer()
    ? `${window.location.protocol}//${window.location.hostname}:8080`
    : window.location.origin;
  return new URL(path, origin).toString();
}

export function resolveWebSocketUrl(path: string, query: URLSearchParams): string {
  const configuredUrl = import.meta.env.VITE_ADJACENCY_WS_URL as string | undefined;
  const url = configuredUrl
    ? new URL(configuredUrl, window.location.href)
    : new URL(path, defaultWebSocketOrigin());
  query.forEach((value, key) => url.searchParams.set(key, value));
  return url.toString();
}

function isViteDevServer(): boolean {
  return ['5173', '4173'].includes(window.location.port);
}

function defaultWebSocketOrigin(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return isViteDevServer()
    ? `${protocol}//${window.location.hostname}:8080`
    : `${protocol}//${window.location.host}`;
}
