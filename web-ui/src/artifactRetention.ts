import type { ArtifactRetentionPolicyConfig } from './types'

function parseRetentionDays(value: string, fieldLabel: string): number | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${fieldLabel}必须是非负整数。`)
  }
  return Number(normalized)
}

export function artifactRetentionPolicyToForm(
  policy?: ArtifactRetentionPolicyConfig | null,
): { archiveAfterDays: string; deleteAfterDays: string } {
  return {
    archiveAfterDays:
      policy?.archiveAfterDays === null || policy?.archiveAfterDays === undefined
        ? ''
        : String(policy.archiveAfterDays),
    deleteAfterDays:
      policy?.deleteAfterDays === null || policy?.deleteAfterDays === undefined
        ? ''
        : String(policy.deleteAfterDays),
  }
}

export function buildArtifactRetentionPolicyInput(
  archiveAfterDays: string,
  deleteAfterDays: string,
): ArtifactRetentionPolicyConfig {
  const archive = parseRetentionDays(archiveAfterDays, '归档天数')
  const remove = parseRetentionDays(deleteAfterDays, '删除天数')
  if (archive !== null && remove !== null && remove < archive) {
    throw new Error('删除天数不能早于归档天数。')
  }
  return {
    enabled: archive !== null || remove !== null,
    archiveAfterDays: archive,
    deleteAfterDays: remove,
  }
}
