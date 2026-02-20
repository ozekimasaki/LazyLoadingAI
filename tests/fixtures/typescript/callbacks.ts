/**
 * Sample file with callback functions for testing callback extraction
 */

import { EventEmitter } from 'node:events';

// Test framework callbacks
describe('UserService', () => {
  beforeAll(() => {
    console.log('Setting up tests');
  });

  afterEach(() => {
    console.log('Cleaning up');
  });

  it('should create a user', async () => {
    const user = { name: 'Test' };
    expect(user.name).toBe('Test');
  });

  test('handles errors gracefully', () => {
    expect(() => {
      throw new Error('test');
    }).toThrow();
  });

  describe('nested describe', () => {
    it('should work nested', () => {
      expect(true).toBe(true);
    });
  });
});

// Event handler callbacks
const emitter = new EventEmitter();

emitter.on('data', (data) => {
  console.log('Received data:', data);
});

emitter.once('ready', () => {
  console.log('Ready!');
});

// Promise chain callbacks
const promise = Promise.resolve(42);

promise
  .then((value) => {
    return value * 2;
  })
  .catch((error) => {
    console.error('Error:', error);
  })
  .finally(() => {
    console.log('Done');
  });

// CLI action callback
const program = {
  action: (fn: () => void) => fn(),
  command: (name: string) => program,
};

program
  .command('build')
  .action(async () => {
    console.log('Building...');
  });

// Array methods (should be skipped)
const numbers = [1, 2, 3];
const doubled = numbers.map((n) => n * 2);
const evens = numbers.filter((n) => n % 2 === 0);
const sum = numbers.reduce((acc, n) => acc + n, 0);

// Regular function for comparison
function regularFunction(x: number): number {
  return x + 1;
}

// Arrow function for comparison
const arrowFunction = (x: number): number => x + 1;

export { regularFunction, arrowFunction };
