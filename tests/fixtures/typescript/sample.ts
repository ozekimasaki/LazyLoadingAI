/**
 * Sample TypeScript file for testing the parser
 */

import { EventEmitter } from 'node:events';
import type { Buffer } from 'node:buffer';

// Type alias
export type UserId = string;

// Interface
export interface User {
  id: UserId;
  name: string;
  email: string;
  age?: number;
}

// Another interface with methods
export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(item: T): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/**
 * A simple greeting function
 * @param name - The name to greet
 * @returns A greeting message
 */
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

/**
 * An async function that fetches user data
 * @param userId - The user ID to fetch
 * @returns The user data or null if not found
 */
export async function fetchUser(userId: UserId): Promise<User | null> {
  // Simulated async operation
  return {
    id: userId,
    name: 'Test User',
    email: 'test@example.com',
  };
}

// Arrow function assigned to const
export const multiply = (a: number, b: number): number => a * b;

// Private function (not exported)
function _privateHelper(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * User service class for managing users
 */
export class UserService extends EventEmitter implements Repository<User> {
  private users: Map<string, User> = new Map();
  readonly serviceName: string = 'UserService';

  /**
   * Create a new UserService instance
   * @param config - Configuration options
   */
  constructor(private config: { maxUsers: number }) {
    super();
  }

  /**
   * Find a user by ID
   * @param id - The user ID
   * @returns The user or null
   */
  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  /**
   * Get all users
   */
  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  /**
   * Save a user
   * @param user - The user to save
   */
  async save(user: User): Promise<void> {
    if (this.users.size >= this.config.maxUsers) {
      throw new Error('Max users reached');
    }
    this.users.set(user.id, user);
    this.emit('userSaved', user);
  }

  /**
   * Delete a user by ID
   * @param id - The user ID to delete
   * @returns True if deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const deleted = this.users.delete(id);
    if (deleted) {
      this.emit('userDeleted', id);
    }
    return deleted;
  }

  /**
   * Get the user count
   */
  get userCount(): number {
    return this.users.size;
  }

  // Static factory method
  static create(maxUsers: number = 100): UserService {
    return new UserService({ maxUsers });
  }

  // Private method
  private validateUser(user: User): boolean {
    return user.id.length > 0 && user.email.includes('@');
  }
}

// Abstract class
export abstract class BaseEntity {
  abstract get entityType(): string;

  toJSON(): object {
    return { type: this.entityType };
  }
}

// Generic function
export function createPair<T, U>(first: T, second: U): [T, U] {
  return [first, second];
}

// Constant export
export const DEFAULT_PAGE_SIZE = 20;
export const API_VERSION = '1.0.0';
