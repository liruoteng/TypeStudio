import "@testing-library/jest-dom/vitest";

// jsdom v29 provides localStorage, but it's keyed to a file path that isn't
// available in test environments. Replace with a simple in-memory mock.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// jsdom does not implement scrollIntoView — provide a no-op stub.
Element.prototype.scrollIntoView = () => {};
