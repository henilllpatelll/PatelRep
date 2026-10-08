/** Message to show for a failed API call: the server's plain-English detail when there is one. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function errorStatus(err: unknown): number | null {
  const status = (err as { status?: number | null } | null)?.status
  return typeof status === 'number' ? status : null
}
