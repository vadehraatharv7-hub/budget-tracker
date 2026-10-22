export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Fired when any request comes back 401, so the app can show the sign-in screen. */
export const AUTH_EVENT = 'budget:auth-required';

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

export async function api<T>(path: string, { method = 'GET', body }: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'The server is unreachable.');
  }
  if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/session')) {
    window.dispatchEvent(new Event(AUTH_EVENT));
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;
