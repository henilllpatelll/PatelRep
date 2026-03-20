// Expo Router 3.5 strips hash fragments from deep link URLs.
// Supabase magic links use the hash to pass tokens: patelrep://auth/callback#access_token=...
// This file converts # to ? so Expo Router can parse tokens as query params.
// Source: https://github.com/expo/router/issues/724

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  return path.includes('#') ? path.replace('#', '?') : path;
}
