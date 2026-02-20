/**
 * File watcher for incremental updates
 */

import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { Indexer } from './index.js';

export interface WatcherEvents {
  indexed: { filePath: string; isNew: boolean };
  removed: { filePath: string };
  error: { filePath: string; error: Error };
  ready: void;
}

export interface WatcherOptions {
  debounceMs?: number;
  ignoreInitial?: boolean;
}

export class Watcher extends EventEmitter {
  private indexer: Indexer;
  private watcher: FSWatcher | null = null;
  private rootDirectory: string;
  private patterns: string[];
  private ignored: string[];
  private options: WatcherOptions;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    indexer: Indexer,
    rootDirectory: string,
    patterns: string[],
    ignored: string[],
    options: WatcherOptions = {}
  ) {
    super();
    this.indexer = indexer;
    this.rootDirectory = rootDirectory;
    this.patterns = patterns;
    this.ignored = ignored;
    this.options = {
      debounceMs: 300,
      ignoreInitial: true,
      ...options,
    };
  }

  async start(): Promise<void> {
    const watchPatterns = this.patterns.map(p => path.join(this.rootDirectory, p));

    this.watcher = chokidar.watch(watchPatterns, {
      ignored: this.ignored,
      persistent: true,
      ignoreInitial: this.options.ignoreInitial,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (filePath) => this.handleFileChange(filePath, 'add'));
    this.watcher.on('change', (filePath) => this.handleFileChange(filePath, 'change'));
    this.watcher.on('unlink', (filePath) => this.handleFileRemove(filePath));
    this.watcher.on('error', (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', { filePath: '', error });
    });
    this.watcher.on('ready', () => this.emit('ready'));
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  private handleFileChange(filePath: string, event: 'add' | 'change'): void {
    // Debounce file changes
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);

      try {
        const wasIndexed = await this.indexer.indexFile(filePath, this.rootDirectory);
        this.emit('indexed', { filePath, isNew: event === 'add' || wasIndexed });
      } catch (error) {
        this.emit('error', {
          filePath,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }, this.options.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  private async handleFileRemove(filePath: string): Promise<void> {
    // Clear any pending debounce timer
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(filePath);
    }

    try {
      await this.indexer.removeFile(filePath);
      this.emit('removed', { filePath });
    } catch (error) {
      this.emit('error', {
        filePath,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  // Type-safe event emitter methods
  override on<K extends keyof WatcherEvents>(
    event: K,
    listener: (arg: WatcherEvents[K]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof WatcherEvents>(
    event: K,
    arg?: WatcherEvents[K]
  ): boolean {
    // EventEmitter treats unhandled "error" events as exceptions.
    // Watchers can emit low-level fs errors (e.g., EMFILE) even when callers
    // have not registered an error listener yet; avoid crashing in that case.
    if (event === 'error' && this.listenerCount('error') === 0) {
      return false;
    }

    return super.emit(event, arg);
  }
}
