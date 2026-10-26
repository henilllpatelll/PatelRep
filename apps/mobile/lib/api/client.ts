import { supabase } from "@/lib/supabase";

export const DEFAULT_API_BASE = "https://noble-cooperation-production.up.railway.app/v1";
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_BASE;
const API_TIMEOUT_MS = 12000;
const API_TIMEOUT_MESSAGE = "Request timed out. Please try again.";

/**
 * Error thrown for any non-2xx API response. Network failures and timeouts are
 * plain `Error`s (no `status`), so callers can tell "the server said no" apart
 * from "the request never got an answer" — the offline sync engine depends on it.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: unknown;
  /** The whole parsed error body when it was a JSON object (e.g. `{ detail, code, room_status }`). */
  readonly body?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, detail?: unknown, body?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.body = body;
  }
}

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

export interface RequestOptions {
  /** Abort the request from the caller's side (e.g. the person cancelled). Rejects with an `AbortError`. */
  signal?: AbortSignal;
}

function abortError(): Error {
  const error = new Error("Request cancelled.");
  error.name = "AbortError";
  return error;
}

/** Build the ApiError for a non-2xx response (shared by JSON and multipart requests). */
export async function toApiError(response: Response): Promise<ApiError> {
  const error = await response.json().catch(() => ({ detail: "Unknown error" }));
  const detail = error?.detail;
  const body = error && typeof error === "object" && !Array.isArray(error) ? (error as Record<string, unknown>) : undefined;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const structured = detail as { code?: string; message?: string };
    return new ApiError(structured.message ?? `HTTP ${response.status}`, response.status, structured.code, detail, body);
  }
  // Endpoints that keep `detail` a plain string (so older clients still render it) put the stable reason in `code`.
  const topLevelCode = typeof body?.code === "string" ? body.code : undefined;
  return new ApiError(
    typeof detail === "string" ? detail : `HTTP ${response.status}`,
    response.status,
    topLevelCode,
    detail,
    body,
  );
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isRetry = false,
  options: RequestOptions = {},
): Promise<T> {
  const headers = await getAuthHeader();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const external = options.signal;
  if (external?.aborted) throw abortError();
  const onExternalAbort = () => controller?.abort();
  external?.addEventListener("abort", onExternalAbort);
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
    if (external?.aborted) throw abortError();
    if (didTimeout || controller?.signal.aborted) {
      throw new Error(API_TIMEOUT_MESSAGE);
    }
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
    external?.removeEventListener("abort", onExternalAbort);
  }

  if (response.status === 401 && !isRetry) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      return request<T>(method, path, body, true, options);
    }
    throw new Error('Session expired. Please log in again.');
  }

  if (!response.ok) throw await toApiError(response);

  return response.json() as Promise<T>;
}

const UPLOAD_TIMEOUT_MS = 60000;

/**
 * POST a multipart form (photos). The Content-Type is left to fetch so the boundary is set; one 401 refreshes the
 * session and retries once. A timeout or network failure is a plain Error (no `status`): the write MAY have landed.
 */
async function postForm<T>(path: string, form: FormData, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const { Authorization } = await getAuthHeader();
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const external = options.signal;
  if (external?.aborted) throw abortError();
  const onExternalAbort = () => controller?.abort();
  external?.addEventListener("abort", onExternalAbort);
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller?.abort();
  }, UPLOAD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { Authorization },
      body: form,
      signal: controller?.signal,
    });
  } catch (err) {
    if (external?.aborted) throw abortError();
    if (didTimeout || controller?.signal.aborted) throw new Error(API_TIMEOUT_MESSAGE);
    throw err;
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener("abort", onExternalAbort);
  }

  if (response.status === 401 && !isRetry) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) return postForm<T>(path, form, options, true);
    throw new Error("Session expired. Please log in again.");
  }
  if (!response.ok) throw await toApiError(response);
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown, options?: RequestOptions) => request<T>("POST", path, body, false, options),
  postForm: <T>(path: string, form: FormData, options?: RequestOptions) => postForm<T>(path, form, options),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
