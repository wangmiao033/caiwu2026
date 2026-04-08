type Entry = { storedAt: number; data: unknown };

const store = new Map<string, Entry>();

/** 列表页切Tab场景：短时复用 GET 结果，减轻重复等待 */
export const SHORT_LIST_TTL_MS = 25_000;

export async function getCachedJson<T>(
  cacheKey: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  forceRefresh = false
): Promise<T> {
  const now = Date.now();
  if (!forceRefresh) {
    const hit = store.get(cacheKey);
    if (hit && now - hit.storedAt < ttlMs) {
      return hit.data as T;
    }
  }
  const data = await fetcher();
  store.set(cacheKey, { storedAt: now, data });
  return data;
}

export function invalidateCachedJson(cacheKey: string) {
  store.delete(cacheKey);
}
