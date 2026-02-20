/**
 * Test fixture for type hierarchy and reference tracking integration tests
 */

export interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  save(item: T): Promise<void>;
}

export abstract class BaseEntity {
  abstract get id(): string;
}

export class User extends BaseEntity implements IRepository<User> {
  private _id: string = '';

  get id(): string {
    return this._id;
  }

  async findById(id: string): Promise<User | null> {
    return null;
  }

  async save(item: User): Promise<void> {}
}

export class AdminUser extends User {
  isAdmin = true;
}

function validateUser(user: User): boolean {
  return user.id.length > 0;
}

function processUsers(users: User[]): void {
  for (const user of users) {
    if (validateUser(user)) {
      user.save(user);
    }
  }
}

export function main(): void {
  processUsers([]);
}
