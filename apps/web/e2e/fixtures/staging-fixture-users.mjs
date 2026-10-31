/**
 * The synthetic staging users. Pure data and lookups, so the seed's identity handling can be tested without a database.
 *
 * Several users may share a role (two housekeepers), so a user is identified by its `key`, never by its role alone.
 * `department` is the explicit department code written to user_roles.department_id; null keeps the role's default.
 */
export const STAGING_FIXTURE_USERS = [
  { key: 'gm', email: 'staging-gm@patelrep.test', fullName: 'Staging GM', role: 'gm', department: null },
  { key: 'front_desk', email: 'staging-front-desk@patelrep.test', fullName: 'Staging Front Desk', role: 'front_desk', department: null },
  { key: 'housekeeping_supervisor', email: 'staging-housekeeping-supervisor@patelrep.test', fullName: 'Staging Housekeeping Supervisor', role: 'housekeeping_supervisor', department: null },
  { key: 'housekeeper', email: 'staging-housekeeper@patelrep.test', fullName: 'Staging Housekeeper', role: 'housekeeper', department: 'HK' },
  { key: 'housekeeper_two', email: 'staging-housekeeper-2@patelrep.test', fullName: 'Staging Housekeeper Two', role: 'housekeeper', department: 'HK' },
  { key: 'chief_engineer', email: 'staging-chief-engineer@patelrep.test', fullName: 'Staging Chief Engineer', role: 'chief_engineer', department: null },
  { key: 'engineer', email: 'staging-engineer@patelrep.test', fullName: 'Staging Engineer', role: 'engineer', department: null },
]

/** Every user whose role is `role`, in declaration order. */
export function usersWithRole(role, users = STAGING_FIXTURE_USERS) {
  return users.filter((user) => user.role === role)
}

/** Preferred name shown in the app: the full name without the "Staging " prefix. */
export function preferredName(fullName) {
  return fullName.replace('Staging ', '')
}

/** Fails loudly on a malformed list: a duplicate key or email would silently merge two people into one account. */
export function assertValidFixtureUsers(users = STAGING_FIXTURE_USERS) {
  const keys = new Set()
  const emails = new Set()
  for (const user of users) {
    if (!user.key || !user.email || !user.fullName || !user.role) throw new Error(`Incomplete fixture user: ${JSON.stringify(user)}`)
    if (!user.email.endsWith('@patelrep.test')) throw new Error(`Fixture email must be synthetic (@patelrep.test): ${user.email}`)
    if (user.email !== user.email.toLowerCase()) throw new Error(`Fixture email must be lower case: ${user.email}`)
    if (keys.has(user.key)) throw new Error(`Duplicate fixture user key: ${user.key}`)
    if (emails.has(user.email)) throw new Error(`Duplicate fixture user email: ${user.email}`)
    keys.add(user.key)
    emails.add(user.email)
  }
  return users
}
