// Developer Harness V3 (D3.3) — owner-login relay filters (pure). Security review S6.
//
// The owner's terminal shows output produced inside the (untrusted) VM. Before display it is stripped of every escape/control sequence (OSC 52
// clipboard writes, OSC 8 hyperlinks, cursor tricks), and every URL is checked: only the official subscription-login hosts are acceptable, and a
// URL asking for the Console API-key scope (a paid-API path) aborts the login. The pasted code goes straight from the owner's keyboard to ssh
// (stdin is inherited); the relay never reads it.
export const LOGIN_HOSTS = Object.freeze(['claude.ai', 'claude.com', 'platform.claude.com'])

/** Remove ESC-introduced sequences (CSI, OSC, DCS, …) and C0/C1 controls except \n, \r, \t. */
export function sanitizeTerminal(s) {
  return String(s)
    .replace(/\u001b\][\s\S]*?(\u0007|\u001b\\)/g, '') // OSC … BEL/ST
    .replace(/\u001b[P^_X][\s\S]*?\u001b\\/g, '') // DCS/PM/APC/SOS … ST
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '') // CSI
    .replace(/\u001b[ -/]*[0-~]/g, '') // other ESC sequences
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0080-\u009f]/g, '')
}

/** Problems with the (sanitized) login output: any URL outside LOGIN_HOSTS, non-HTTPS, or requesting the API-key scope. */
export function loginOutputProblems(text) {
  const problems = []
  for (const m of String(text).matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi)) {
    let u
    try { u = new URL(m[0]) } catch { problems.push('LOGIN.URL_UNPARSABLE'); continue }
    if (u.protocol !== 'https:') problems.push('LOGIN.URL_NOT_HTTPS')
    if (!LOGIN_HOSTS.includes(u.hostname.toLowerCase())) problems.push(`LOGIN.URL_HOST_NOT_ALLOWED:${u.hostname.slice(0, 60)}`)
    if (/create_api_key/i.test(decodeURIComponent(u.search)) || /console/i.test(u.hostname)) problems.push('LOGIN.API_KEY_SCOPE_REQUESTED')
    if (u.username || u.password) problems.push('LOGIN.URL_USERINFO')
  }
  return [...new Set(problems)]
}
