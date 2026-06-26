import { supabase } from "@/lib/supabase";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.patelrep.com/v1";
const API_TIMEOUT_MS = 12000;
const API_TIMEOUT_MESSAGE = "Request timed out. Please try again.";

async function getAuthHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isRetry = false
): Promise<T> {
  const headers = await getAuthHeader();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let didTimeout = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      didTimeout = true;
      controller?.abort();
      reject(new Error(API_TIMEOUT_MESSAGE));
    }, API_TIMEOUT_MS);
  });

  let response: Response;
  try {
    response = await Promise.race([
      fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller?.signal,
      }),
      timeoutPromise,
    ]);
  } catch (err) {
    if (didTimeout || controller?.signal.aborted) {
      throw new Error(API_TIMEOUT_MESSAGE);
    }
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  if (response.status === 401 && !isRetry) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      return request<T>(method, path, body, true);
    }
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail ?? `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
