import { Window } from "happy-dom";

const window = new Window({
  url: "http://localhost:3000",
});

// @ts-ignore
global.window = window;
// @ts-ignore
global.document = window.document;
// @ts-ignore
global.HTMLElement = window.HTMLElement;
// @ts-ignore
global.Element = window.Element;
// @ts-ignore
global.Node = window.Node;
// @ts-ignore
global.DocumentFragment = window.DocumentFragment;
// @ts-ignore
global.Event = window.Event;
// @ts-ignore
global.MouseEvent = window.MouseEvent;
// @ts-ignore
global.KeyboardEvent = window.KeyboardEvent;
// @ts-ignore
global.requestAnimationFrame = (callback: FrameRequestCallback) => {
  return setTimeout(callback, 16) as unknown as number;
};
// @ts-ignore
global.cancelAnimationFrame = (id: number) => {
  clearTimeout(id);
};
// @ts-ignore
global.getComputedStyle = window.getComputedStyle.bind(window);
// @ts-ignore
global.MutationObserver = window.MutationObserver;
// @ts-ignore
global.NodeFilter = window.NodeFilter;
// @ts-ignore
global.HTMLInputElement = window.HTMLInputElement;

// Mock ResizeObserver for testing
class MockResizeObserver {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(_target: Element) {
    // No-op in tests
  }

  unobserve(_target: Element) {
    // No-op in tests
  }

  disconnect() {
    // No-op in tests
  }
}

// @ts-ignore
global.ResizeObserver = MockResizeObserver;

// Prevent accidental real network calls in unit tests.
// Individual tests can override this with vi.fn() as needed.
// @ts-ignore
global.fetch = (..._args: any[]) => {
  return Promise.reject(new Error("Unexpected fetch in unit test"));
};
