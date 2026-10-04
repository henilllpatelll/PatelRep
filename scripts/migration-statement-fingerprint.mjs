// The ONE normalization/fingerprint contract for stored production migration statements. Shared by the read-only
// evidence audit and the production drift checker so an attested fingerprint can never diverge from what the
// audit reported. Only a SHA-256 of the normalized statements is ever stored or printed, never raw SQL.
import { createHash } from 'node:crypto';

export function normalizeSql(sql) {
  return String(sql).replace(/\r\n/g, '\n').trim().replace(/\s+/g, ' ');
}

export function fingerprintStatements(statements) {
  const normalized = (Array.isArray(statements) ? statements : [statements]).map(normalizeSql);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
