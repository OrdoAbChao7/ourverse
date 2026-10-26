import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

// jsdom exposes `crypto.getRandomValues` but not `crypto.subtle`, which the
// offline museum needs for SHA-256. Node's WebCrypto is API-compatible.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}
if (typeof window !== 'undefined' && !window.crypto?.subtle) {
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
}

// jsdom 26 does not implement Blob.arrayBuffer(). FileReader works there and
// returns the same bytes the builder would read in a browser.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value: function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error ?? new Error('读取 Blob 失败'));
        reader.readAsArrayBuffer(this);
      });
    },
  });
}
