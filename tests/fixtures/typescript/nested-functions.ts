/**
 * Test fixture for nested function extraction
 */

// Simple nested function
export function outerFunction(x: number): number {
  function innerHelper(y: number): number {
    return y * 2;
  }

  return innerHelper(x) + x;
}

// React-style hook with multiple nested functions
export function useOrchestration(options: { retryEnabled: boolean }) {
  const state = { pending: false, queue: [] as string[] };

  function hasPendingRetry(): boolean {
    return state.pending && options.retryEnabled;
  }

  function executeRetry(item: string): void {
    console.log('Retrying:', item);
    state.queue.push(item);
  }

  const processQueue = async (): Promise<void> => {
    for (const item of state.queue) {
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log('Processed:', item);
    }
  };

  return { hasPendingRetry, executeRetry, processQueue };
}

// Arrow function with nested functions
export const createCalculator = (initialValue: number) => {
  let value = initialValue;

  const add = (n: number): number => {
    value += n;
    return value;
  };

  function subtract(n: number): number {
    value -= n;
    return value;
  }

  function multiply(n: number): number {
    // Deeply nested function
    function doubleFirst(x: number): number {
      return x * 2;
    }
    value *= doubleFirst(n);
    return value;
  }

  return { add, subtract, multiply, getValue: () => value };
};

// Three-level nesting
export function level1Function(): void {
  function level2Function(): void {
    function level3Function(): void {
      console.log('Level 3');
    }
    level3Function();
  }
  level2Function();
}

// Small functions that should be skipped (less than 3 lines)
export function withSmallNested(): number {
  const tiny = (x: number) => x + 1;
  return tiny(5);
}

// Deeply nested beyond 3 levels (level 4+ should not be extracted)
export function deeplyNested(): void {
  function level2(): void {
    function level3(): void {
      function level4(): void {
        function level5(): void {
          console.log('Too deep');
        }
        level5();
      }
      level4();
    }
    level3();
  }
  level2();
}

// Functions inside array methods should NOT be extracted (inline callbacks)
export function withArrayMethods(): number[] {
  const arr = [1, 2, 3];
  return arr.map(x => x * 2).filter(x => x > 2);
}

// Async nested function
export async function asyncOuter(): Promise<void> {
  async function asyncInner(): Promise<string> {
    return 'Hello from nested async';
  }

  const result = await asyncInner();
  console.log(result);
}

// Private nested function (starts with _)
export function withPrivateNested(): number {
  function _privateHelper(x: number): number {
    return x * 3;
  }
  return _privateHelper(10);
}
