/**
 * Mock chokidar for file watcher tests
 */

import { EventEmitter } from 'node:events';

export interface MockWatcherEvents {
  add: string;
  change: string;
  unlink: string;
  error: Error;
  ready: void;
}

/**
 * Create a mock file watcher that simulates chokidar
 */
export function createMockChokidar() {
  const emitter = new EventEmitter();
  let closed = false;

  const mockWatcher = {
    on(event: string, handler: (...args: unknown[]) => void) {
      emitter.on(event, handler);
      return mockWatcher;
    },

    off(event: string, handler: (...args: unknown[]) => void) {
      emitter.off(event, handler);
      return mockWatcher;
    },

    close(): Promise<void> {
      closed = true;
      emitter.removeAllListeners();
      return Promise.resolve();
    },

    // Test helpers
    simulateAdd(filePath: string): void {
      if (!closed) {
        emitter.emit('add', filePath);
      }
    },

    simulateChange(filePath: string): void {
      if (!closed) {
        emitter.emit('change', filePath);
      }
    },

    simulateUnlink(filePath: string): void {
      if (!closed) {
        emitter.emit('unlink', filePath);
      }
    },

    simulateError(error: Error): void {
      if (!closed) {
        emitter.emit('error', error);
      }
    },

    simulateReady(): void {
      if (!closed) {
        emitter.emit('ready');
      }
    },

    isClosed(): boolean {
      return closed;
    },
  };

  return mockWatcher;
}

export type MockChokidar = ReturnType<typeof createMockChokidar>;

/**
 * Create a mock chokidar module that returns the mock watcher
 */
export function createMockChokidarModule() {
  const mockWatcher = createMockChokidar();

  return {
    mockWatcher,
    watch: (_patterns: string | string[], _options?: unknown) => mockWatcher,
  };
}
