/**
 * Nested module for testing directory traversal
 */

export interface NestedConfig {
  enabled: boolean;
  name: string;
  options?: Record<string, unknown>;
}

export function processNestedConfig(config: NestedConfig): void {
  console.log('Processing nested config:', config.name);
}

export class NestedService {
  private config: NestedConfig;

  constructor(config: NestedConfig) {
    this.config = config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getName(): string {
    return this.config.name;
  }
}

export const NESTED_CONSTANT = 'nested-value';
