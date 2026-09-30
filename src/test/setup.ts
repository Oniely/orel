// Browser APIs jsdom lacks but the UI libraries rely on.

// react-aria's menus call CSS.escape when they open
if (!globalThis.CSS?.escape) {
  Object.defineProperty(globalThis, "CSS", {
    value: { escape: (value: string) => value.replace(/[^\w-]/g, (c) => `\\${c}`) },
  });
}
