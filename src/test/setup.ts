// Browser APIs jsdom lacks but the UI libraries rely on.

// react-aria's menus call CSS.escape when they open
if (!globalThis.CSS?.escape) {
  Object.defineProperty(globalThis, "CSS", {
    value: { escape: (value: string) => value.replace(/[^\w-]/g, (c) => `\\${c}`) },
  });
}

// Newer Node versions ship a global `localStorage` that shadows jsdom's and is unusable
// without `--localstorage-file`; swap in an in-memory one for stores that persist settings
if (typeof globalThis.localStorage?.setItem !== "function") {
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, String(value)),
      removeItem: (key: string) => void items.delete(key),
      clear: () => items.clear(),
      key: (index: number) => [...items.keys()][index] ?? null,
      get length() {
        return items.size;
      },
    },
  });
}
