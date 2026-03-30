type CacheEnvelope<T> = {
  timestamp: number;
  data: T;
};

const memoryCache = new Map<string, CacheEnvelope<unknown>>();
const CACHE_PREFIX = 'admin-cache:';
const DEFAULT_MAX_AGE_MS = 60_000;

const getStorageKey = (key: string) => `${CACHE_PREFIX}${key}`;

export const getCachedAdminData = <T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | null => {
  const memoryEntry = memoryCache.get(key) as CacheEnvelope<T> | undefined;
  if (memoryEntry && Date.now() - memoryEntry.timestamp <= maxAgeMs) {
    return memoryEntry.data;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.sessionStorage.getItem(getStorageKey(key));
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as CacheEnvelope<T>;
    if (Date.now() - parsed.timestamp > maxAgeMs) {
      window.sessionStorage.removeItem(getStorageKey(key));
      return null;
    }

    memoryCache.set(key, parsed as CacheEnvelope<unknown>);
    return parsed.data;
  } catch {
    window.sessionStorage.removeItem(getStorageKey(key));
    return null;
  }
};

export const setCachedAdminData = <T>(key: string, data: T) => {
  const entry: CacheEnvelope<T> = {
    timestamp: Date.now(),
    data,
  };

  memoryCache.set(key, entry as CacheEnvelope<unknown>);

  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(getStorageKey(key), JSON.stringify(entry));
  }
};

export const invalidateAdminDataCache = (prefix = '') => {
  for (const key of [...memoryCache.keys()]) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }

  if (typeof window === 'undefined') {
    return;
  }

  for (const storageKey of Object.keys(window.sessionStorage)) {
    if (storageKey.startsWith(CACHE_PREFIX) && storageKey.slice(CACHE_PREFIX.length).startsWith(prefix)) {
      window.sessionStorage.removeItem(storageKey);
    }
  }
};
