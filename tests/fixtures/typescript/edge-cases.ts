/**
 * Edge cases for TypeScript parser testing
 */

// Overloaded function declarations
export function processValue(value: string): string;
export function processValue(value: number): number;
export function processValue(value: string | number): string | number {
  if (typeof value === 'string') {
    return value.toUpperCase();
  }
  return value * 2;
}

// Complex generics with constraints
export function merge<T extends object, U extends object>(
  obj1: T,
  obj2: U
): T & U {
  return { ...obj1, ...obj2 };
}

// Generic function with multiple type parameters and defaults
export function createContainer<
  T,
  K extends keyof T = keyof T,
  V extends T[K] = T[K]
>(key: K, value: V): { key: K; value: V } {
  return { key, value };
}

// Decorators (for testing decorator extraction)
function logged(target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = function (...args: unknown[]) {
    console.log(`Calling ${propertyKey}`);
    return original.apply(this, args);
  };
  return descriptor;
}

function classDecorator<T extends { new (...args: unknown[]): object }>(constructor: T) {
  return class extends constructor {
    decoratedBy = 'classDecorator';
  };
}

// Decorated class with decorated methods
@classDecorator
export class DecoratedService {
  @logged
  processData(data: string): string {
    return data.trim();
  }

  @logged
  async asyncProcess(data: string): Promise<string> {
    return Promise.resolve(data);
  }
}

// Nested classes (class expressions)
export class OuterClass {
  InnerClass = class {
    innerMethod(): string {
      return 'inner';
    }
  };

  createInner() {
    return new this.InnerClass();
  }
}

// Abstract class with abstract methods
export abstract class AbstractService<T> {
  abstract findAll(): Promise<T[]>;
  abstract findById(id: string): Promise<T | null>;

  // Concrete method
  async exists(id: string): Promise<boolean> {
    const item = await this.findById(id);
    return item !== null;
  }
}

// Interface with call signature and index signature
export interface CallableMap<T> {
  (key: string): T | undefined;
  [key: string]: T;
  get(key: string): T | undefined;
  set(key: string, value: T): void;
}

// Type with conditional types
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
export type ArrayElement<T> = T extends Array<infer E> ? E : never;
export type ExtractReturnType<T> = T extends (...args: unknown[]) => infer R ? R : never;

// Mapped type
export type Readonly2<T> = {
  readonly [P in keyof T]: T[P];
};

// Template literal types
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type Endpoint = `/${string}`;
export type ApiRoute = `${HttpMethod} ${Endpoint}`;

// Function with rest parameters and tuple types
export function combine<T extends unknown[]>(...args: T): T {
  return args;
}

// Async generator function
export async function* asyncNumberGenerator(max: number): AsyncGenerator<number, void, unknown> {
  for (let i = 0; i < max; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
    yield i;
  }
}

// Generator function
export function* numberSequence(start: number, end: number): Generator<number, void, unknown> {
  for (let i = start; i <= end; i++) {
    yield i;
  }
}

// Class with getter/setter and private fields
export class PrivateFieldClass {
  #privateValue: number = 0;
  private _protectedValue: string = '';

  get value(): number {
    return this.#privateValue;
  }

  set value(v: number) {
    this.#privateValue = v;
  }

  get protectedValue(): string {
    return this._protectedValue;
  }

  set protectedValue(v: string) {
    this._protectedValue = v;
  }
}

// Namespace (module augmentation)
export namespace Utils {
  export function formatDate(date: Date): string {
    return date.toISOString();
  }

  export interface FormatOptions {
    locale?: string;
    timezone?: string;
  }
}

// Re-export with rename
export { DecoratedService as RenamedService };

// Default export
export default class DefaultExportClass {
  static instanceCount = 0;

  constructor() {
    DefaultExportClass.instanceCount++;
  }
}
