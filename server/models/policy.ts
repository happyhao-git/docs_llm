// Visits read saved data. Explicit refreshes share a global cooldown, while
// unattended synchronization retains the hourly interval.
export const MODEL_SYNC_INTERVAL_MINUTES = 60
export const MODEL_SYNC_INTERVAL_MS = MODEL_SYNC_INTERVAL_MINUTES * 60_000
export const MODEL_SNAPSHOT_STALE_MS = 2 * MODEL_SYNC_INTERVAL_MS
export const MODEL_SYNC_COOLDOWN_MS = 60_000
