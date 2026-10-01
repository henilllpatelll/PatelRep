import packagedReleaseIdentity from '@/release-identity.json'

export interface ReleaseMetadata {
  fullSha: string
  shortSha: string
  version: string
}

const SHA_PATTERN = /^[a-f0-9]{7,64}$/i
const VERSION_PATTERN = /^[a-z0-9][a-z0-9.+_-]{0,31}$/i

export function releaseIdentityValue(packagedValue: string | null, environmentValue: string | undefined): string | undefined {
  return packagedValue?.trim() || environmentValue
}

/** Public-only deployment metadata; never pass arbitrary environment text to the browser. */
export function releaseMetadata(
  value = releaseIdentityValue(packagedReleaseIdentity.release_sha, process.env.NEXT_PUBLIC_RELEASE_SHA),
  versionValue = releaseIdentityValue(packagedReleaseIdentity.release_version, process.env.NEXT_PUBLIC_RELEASE_VERSION),
): ReleaseMetadata {
  const fullSha = value?.trim().toLowerCase() ?? ''
  const version = versionValue?.trim() ?? ''
  const shaResult = SHA_PATTERN.test(fullSha)
    ? { fullSha, shortSha: fullSha.slice(0, 7) }
    : { fullSha: 'unknown', shortSha: 'unknown' }
  return { ...shaResult, version: VERSION_PATTERN.test(version) ? version : 'unknown' }
}
