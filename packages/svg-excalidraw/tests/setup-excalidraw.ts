if (typeof window !== "undefined") {
  class ResizeObserverStub implements ResizeObserver {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });

  const canvasContext = new Proxy(
    {
      canvas: document.createElement("canvas"),
      filter: "none",
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      getLineDash: () => [],
      measureText: (text: string) => ({
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
        width: text.length * 8,
      }),
    },
    {
      get(target, property) {
        if (property in target) {
          return Reflect.get(target, property);
        }
        return () => undefined;
      },
    },
  );

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => canvasContext,
  });
}
