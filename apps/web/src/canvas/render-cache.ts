type Disposable = { delete: () => void };

/** Small LRU cache that deletes evicted WASM objects. */
export const createLruCache = <T extends Disposable>(max: number) => {
  const map = new Map<string, T>();
  return {
    get: (key: string): T | undefined => {
      const value = map.get(key);
      if (value === undefined) return undefined;
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set: (key: string, value: T) => {
      map.set(key, value);
      if (map.size <= max) return;
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.get(oldest.value)?.delete();
      map.delete(oldest.value);
    },
  };
};
