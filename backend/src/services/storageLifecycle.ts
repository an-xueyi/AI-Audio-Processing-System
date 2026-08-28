/* Provide one backend definition of whether private job storage has expired. */

export type StorageLifecycleRecord = {
  storage_expires_at: Date | null;
  storage_deleted_at: Date | null;
};

export function hasStorageExpired(
  job: StorageLifecycleRecord,
  now: Date = new Date(),
): boolean {
  // A deletion timestamp is final proof that cleanup already removed the files.
  if (job.storage_deleted_at !== null) {
    return true;
  }

  // Active and older unmigrated records may have no deadline. Null is kept
  // separate from a date instead of being converted into an accidental epoch.
  if (job.storage_expires_at === null) {
    return false;
  }

  // Date#getTime converts both values to milliseconds. Equality counts as
  // expired because downloads are permitted only before the deadline.
  return job.storage_expires_at.getTime() <= now.getTime();
}

