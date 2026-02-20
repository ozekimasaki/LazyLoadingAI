/**
 * Default synonym database - comprehensive programming concept thesaurus
 * Contains 200+ synonym mappings for common programming concepts
 */

import type { SynonymEntry } from './types.js';

/**
 * Helper to create a simple synonym entry with default weights
 */
function simpleEntry(
  canonical: string,
  category: import('./types.js').SynonymCategory,
  synonyms: string[],
  defaultWeight = 0.8
): SynonymEntry {
  return {
    canonical,
    category,
    synonyms: synonyms.map(term => ({
      term,
      relation: 'conceptual' as const,
      weight: defaultWeight,
      bidirectional: true,
    })),
  };
}

/**
 * Helper to create a synonym entry with fine-grained control over directionality
 * Use this when some synonyms should be bidirectional and others should not
 */
function directionalEntry(
  canonical: string,
  category: import('./types.js').SynonymCategory,
  synonyms: Array<{ term: string; bidirectional?: boolean; weight?: number }>
): SynonymEntry {
  return {
    canonical,
    category,
    synonyms: synonyms.map(s => ({
      term: s.term,
      relation: 'conceptual' as const,
      weight: s.weight ?? 0.8,
      bidirectional: s.bidirectional ?? true,
    })),
  };
}

/**
 * Default synonym database
 */
export const DEFAULT_SYNONYMS: SynonymEntry[] = [
  // ============================================
  // AUTHENTICATION & SECURITY
  // ============================================
  {
    canonical: 'authentication',
    category: 'auth',
    synonyms: [
      { term: 'auth', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'authn', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'login', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'signin', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'sign_in', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'logon', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'credential', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'token', relation: 'implementation', weight: 0.6, bidirectional: false },
      { term: 'session', relation: 'implementation', weight: 0.6, bidirectional: false },
      { term: 'jwt', relation: 'implementation', weight: 0.5, bidirectional: false },
      { term: 'oauth', relation: 'implementation', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'authorization',
    category: 'auth',
    synonyms: [
      { term: 'authz', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'permission', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'access', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'role', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'acl', relation: 'implementation', weight: 0.6, bidirectional: false },
      { term: 'rbac', relation: 'implementation', weight: 0.6, bidirectional: false },
      { term: 'policy', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'grant', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'logout',
    category: 'auth',
    synonyms: [
      { term: 'signout', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'sign_out', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'logoff', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'disconnect', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'terminate_session', relation: 'conceptual', weight: 0.8, bidirectional: false },
    ],
  },
  {
    canonical: 'password',
    category: 'auth',
    synonyms: [
      { term: 'pwd', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'passwd', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'secret', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'passphrase', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'hash', relation: 'implementation', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'encrypt',
    category: 'auth',
    synonyms: [
      { term: 'cipher', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'encode', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'scramble', relation: 'conceptual', weight: 0.5, bidirectional: false },
      { term: 'protect', relation: 'conceptual', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'decrypt',
    category: 'auth',
    synonyms: [
      { term: 'decipher', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'decode', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'unscramble', relation: 'conceptual', weight: 0.5, bidirectional: false },
    ],
  },

  // ============================================
  // CRUD OPERATIONS
  // ============================================
  {
    canonical: 'create',
    category: 'crud',
    synonyms: [
      { term: 'add', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'insert', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'new', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'make', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'build', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'generate', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'construct', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'spawn', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'instantiate', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'register', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'post', relation: 'implementation', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'read',
    category: 'crud',
    synonyms: [
      { term: 'get', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'fetch', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'load', relation: 'exact', weight: 0.85, bidirectional: true },
      { term: 'retrieve', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'find', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'query', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'select', relation: 'implementation', weight: 0.7, bidirectional: false },
      { term: 'lookup', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'obtain', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'acquire', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'pull', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'update',
    category: 'crud',
    synonyms: [
      { term: 'modify', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'edit', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'change', relation: 'exact', weight: 0.85, bidirectional: true },
      { term: 'set', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'patch', relation: 'implementation', weight: 0.85, bidirectional: true },
      { term: 'put', relation: 'implementation', weight: 0.7, bidirectional: false },
      { term: 'mutate', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'alter', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'revise', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'refresh', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'sync', relation: 'conceptual', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'delete',
    category: 'crud',
    synonyms: [
      { term: 'remove', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'destroy', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'drop', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'clear', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'purge', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'erase', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'unset', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'discard', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'trash', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'unregister', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'list',
    category: 'crud',
    synonyms: [
      { term: 'getall', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'get_all', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'fetchall', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'enumerate', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'index', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'browse', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'scan', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'search',
    category: 'crud',
    synonyms: [
      { term: 'find', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'query', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'lookup', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'filter', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'locate', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'seek', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'match', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },

  // ============================================
  // DATA & STORAGE
  // ============================================
  {
    canonical: 'database',
    category: 'data',
    synonyms: [
      { term: 'db', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'store', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'storage', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'repository', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'repo', relation: 'abbreviation', weight: 0.65, bidirectional: false },
      { term: 'persist', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'datastore', relation: 'exact', weight: 0.9, bidirectional: true },
    ],
  },
  {
    canonical: 'cache',
    category: 'data',
    synonyms: [
      { term: 'memoize', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'memo', relation: 'abbreviation', weight: 0.75, bidirectional: false },
      { term: 'lru', relation: 'implementation', weight: 0.6, bidirectional: false },
      { term: 'ttl', relation: 'implementation', weight: 0.5, bidirectional: false },
      { term: 'redis', relation: 'implementation', weight: 0.5, bidirectional: false },
      { term: 'memcache', relation: 'implementation', weight: 0.5, bidirectional: false },
      { term: 'buffer', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'queue',
    category: 'data',
    synonyms: [
      { term: 'job', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'task', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'worker', relation: 'implementation', weight: 0.6, bidirectional: false },
      { term: 'background', relation: 'conceptual', weight: 0.5, bidirectional: false },
      { term: 'rabbitmq', relation: 'implementation', weight: 0.4, bidirectional: false },
      { term: 'sqs', relation: 'implementation', weight: 0.4, bidirectional: false },
      { term: 'message', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'enqueue', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'dequeue', relation: 'conceptual', weight: 0.85, bidirectional: true },
    ],
  },
  {
    canonical: 'serialize',
    category: 'data',
    synonyms: [
      { term: 'marshal', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'encode', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'stringify', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'dump', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'pickle', relation: 'implementation', weight: 0.7, bidirectional: false, languageHint: 'python' },
      { term: 'tojson', relation: 'conceptual', weight: 0.8, bidirectional: true },
    ],
  },
  {
    canonical: 'deserialize',
    category: 'data',
    synonyms: [
      { term: 'unmarshal', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'decode', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'parse', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'load', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'unpickle', relation: 'implementation', weight: 0.7, bidirectional: false, languageHint: 'python' },
      { term: 'fromjson', relation: 'conceptual', weight: 0.8, bidirectional: true },
    ],
  },

  // ============================================
  // ERROR HANDLING
  // ============================================
  {
    canonical: 'error',
    category: 'errors',
    synonyms: [
      { term: 'err', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'exception', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'fault', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'failure', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'problem', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'issue', relation: 'conceptual', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'throw',
    category: 'errors',
    synonyms: [
      { term: 'raise', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'emit', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'trigger', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'catch',
    category: 'errors',
    synonyms: [
      { term: 'handle', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'except', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'trap', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'intercept', relation: 'conceptual', weight: 0.7, bidirectional: false },
    ],
  },
  {
    canonical: 'validate',
    category: 'errors',
    synonyms: [
      { term: 'check', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'verify', relation: 'conceptual', weight: 0.9, bidirectional: true },
      { term: 'assert', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'ensure', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'sanitize', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'confirm', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'test', relation: 'conceptual', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'log',
    category: 'errors',
    synonyms: [
      { term: 'logger', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'logging', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'debug', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'trace', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'warn', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'info', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'print', relation: 'conceptual', weight: 0.5, bidirectional: false },
      { term: 'console', relation: 'implementation', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'retry',
    category: 'errors',
    synonyms: [
      { term: 'reattempt', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'backoff', relation: 'implementation', weight: 0.7, bidirectional: false },
      { term: 'exponential', relation: 'implementation', weight: 0.5, bidirectional: false },
      { term: 'resilient', relation: 'conceptual', weight: 0.5, bidirectional: false },
    ],
  },

  // ============================================
  // ASYNC PATTERNS
  // ============================================
  {
    canonical: 'async',
    category: 'async',
    synonyms: [
      { term: 'await', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'promise', relation: 'implementation', weight: 0.85, bidirectional: true },
      { term: 'concurrent', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'parallel', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'future', relation: 'implementation', weight: 0.75, bidirectional: false },
      { term: 'coroutine', relation: 'implementation', weight: 0.7, bidirectional: false, languageHint: 'python' },
      { term: 'nonblocking', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'callback',
    category: 'async',
    synonyms: [
      { term: 'cb', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'handler', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'listener', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'hook', relation: 'conceptual', weight: 0.75, bidirectional: true },
      { term: 'on', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'emit', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'event', relation: 'conceptual', weight: 0.7, bidirectional: false },
    ],
  },
  {
    canonical: 'subscribe',
    category: 'async',
    synonyms: [
      { term: 'sub', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'listen', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'observe', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'watch', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'register', relation: 'conceptual', weight: 0.65, bidirectional: false },
    ],
  },
  {
    canonical: 'unsubscribe',
    category: 'async',
    synonyms: [
      { term: 'unsub', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'unlisten', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'unwatch', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'detach', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'disconnect', relation: 'conceptual', weight: 0.65, bidirectional: false },
    ],
  },
  {
    canonical: 'publish',
    category: 'async',
    synonyms: [
      { term: 'pub', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'emit', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'broadcast', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'dispatch', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'send', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'notify', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'trigger', relation: 'conceptual', weight: 0.7, bidirectional: false },
    ],
  },

  // ============================================
  // HTTP / API
  // ============================================
  {
    canonical: 'request',
    category: 'http',
    synonyms: [
      { term: 'req', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'http', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'fetch', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'call', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'invoke', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'api', relation: 'conceptual', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'response',
    category: 'http',
    synonyms: [
      { term: 'res', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'resp', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'reply', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'result', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'output', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'middleware',
    category: 'http',
    synonyms: [
      { term: 'interceptor', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'filter', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'guard', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'pipe', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'hook', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'handler', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'route',
    category: 'http',
    synonyms: [
      { term: 'path', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'endpoint', relation: 'conceptual', weight: 0.9, bidirectional: true },
      { term: 'url', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'uri', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'handler', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'controller', relation: 'implementation', weight: 0.65, bidirectional: false },
    ],
  },
  {
    canonical: 'header',
    category: 'http',
    synonyms: [
      { term: 'headers', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'metadata', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'body',
    category: 'http',
    synonyms: [
      { term: 'payload', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'content', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'data', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },

  // ============================================
  // USER & ACCOUNT
  // ============================================
  {
    canonical: 'user',
    category: 'domain',
    synonyms: [
      { term: 'account', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'member', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'profile', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'person', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'customer', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'client', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'subscriber', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'admin',
    category: 'domain',
    synonyms: [
      { term: 'administrator', relation: 'exact', weight: 0.95, bidirectional: true },
      { term: 'superuser', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'root', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'operator', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'manager', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },

  // ============================================
  // COMMON ABBREVIATIONS
  // ============================================
  {
    canonical: 'configuration',
    category: 'common',
    synonyms: [
      { term: 'config', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'cfg', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'conf', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'settings', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'options', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'opts', relation: 'abbreviation', weight: 0.75, bidirectional: true },
      { term: 'prefs', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'preferences', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'params', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'initialize',
    category: 'common',
    synonyms: [
      { term: 'init', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'setup', relation: 'conceptual', weight: 0.9, bidirectional: true },
      { term: 'bootstrap', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'start', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'mount', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'prepare', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'configure', relation: 'conceptual', weight: 0.7, bidirectional: false },
    ],
  },
  {
    canonical: 'terminate',
    category: 'common',
    synonyms: [
      { term: 'shutdown', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'close', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'stop', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'end', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'cleanup', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'destroy', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'dispose', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'teardown', relation: 'conceptual', weight: 0.8, bidirectional: true },
    ],
  },
  {
    canonical: 'utility',
    category: 'common',
    synonyms: [
      { term: 'util', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'utils', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'helper', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'helpers', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'common', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'shared', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'lib', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'component',
    category: 'common',
    synonyms: [
      { term: 'comp', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'widget', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'element', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'module', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'part', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'block', relation: 'conceptual', weight: 0.55, bidirectional: false },
    ],
  },
  {
    canonical: 'transform',
    category: 'common',
    synonyms: [
      { term: 'convert', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'map', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'parse', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'format', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'encode', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'translate', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'morph', relation: 'conceptual', weight: 0.65, bidirectional: false },
    ],
  },
  {
    canonical: 'render',
    category: 'common',
    synonyms: [
      { term: 'draw', relation: 'conceptual', weight: 0.8, bidirectional: true },
      { term: 'display', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'paint', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'show', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'present', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'output', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'calculate',
    category: 'common',
    synonyms: [
      { term: 'calc', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'compute', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'evaluate', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'process', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'determine', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'message',
    category: 'common',
    synonyms: [
      { term: 'msg', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'notification', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'alert', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'notice', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'text', relation: 'conceptual', weight: 0.5, bidirectional: false },
    ],
  },
  {
    canonical: 'document',
    category: 'common',
    synonyms: [
      { term: 'doc', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'docs', relation: 'abbreviation', weight: 0.9, bidirectional: true },
      { term: 'file', relation: 'conceptual', weight: 0.6, bidirectional: false },
      { term: 'record', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'identifier',
    category: 'common',
    synonyms: [
      { term: 'id', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'uid', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'uuid', relation: 'implementation', weight: 0.8, bidirectional: true },
      { term: 'guid', relation: 'implementation', weight: 0.8, bidirectional: true },
      { term: 'key', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'ref', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },
  {
    canonical: 'execute',
    category: 'common',
    synonyms: [
      { term: 'exec', relation: 'abbreviation', weight: 0.95, bidirectional: true },
      { term: 'run', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'invoke', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'call', relation: 'conceptual', weight: 0.8, bidirectional: false },
      { term: 'perform', relation: 'conceptual', weight: 0.75, bidirectional: false },
      { term: 'apply', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'trigger', relation: 'conceptual', weight: 0.65, bidirectional: false },
    ],
  },
  {
    canonical: 'enable',
    category: 'common',
    synonyms: [
      { term: 'activate', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'turnon', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'turn_on', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'start', relation: 'conceptual', weight: 0.7, bidirectional: false },
      { term: 'allow', relation: 'conceptual', weight: 0.65, bidirectional: false },
    ],
  },
  {
    canonical: 'disable',
    category: 'common',
    synonyms: [
      { term: 'deactivate', relation: 'exact', weight: 0.9, bidirectional: true },
      { term: 'turnoff', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'turn_off', relation: 'conceptual', weight: 0.85, bidirectional: true },
      { term: 'stop', relation: 'conceptual', weight: 0.65, bidirectional: false },
      { term: 'block', relation: 'conceptual', weight: 0.6, bidirectional: false },
    ],
  },

  // ============================================
  // DESIGN PATTERNS
  // ============================================
  simpleEntry('factory', 'patterns', ['builder', 'creator', 'maker', 'producer', 'generator']),
  simpleEntry('singleton', 'patterns', ['instance', 'global', 'shared']),
  simpleEntry('observer', 'patterns', ['listener', 'watcher', 'subscriber', 'notifier']),
  simpleEntry('strategy', 'patterns', ['policy', 'algorithm', 'behavior']),
  simpleEntry('adapter', 'patterns', ['wrapper', 'bridge', 'translator', 'converter']),
  simpleEntry('decorator', 'patterns', ['wrapper', 'enhancer', 'modifier']),
  simpleEntry('facade', 'patterns', ['interface', 'gateway', 'wrapper', 'simplifier']),
  simpleEntry('repository', 'patterns', ['dao', 'store', 'dataaccess', 'data_access']),
  simpleEntry('service', 'patterns', ['provider', 'manager', 'handler']),
  simpleEntry('controller', 'patterns', ['handler', 'manager', 'coordinator']),
  simpleEntry('model', 'patterns', ['entity', 'domain', 'data', 'schema']),
  simpleEntry('view', 'patterns', ['template', 'ui', 'display', 'presentation']),

  // ============================================
  // TESTING
  // ============================================
  directionalEntry('test', 'patterns', [
    { term: 'spec', bidirectional: true },           // test-specific
    { term: 'unit', bidirectional: true },           // test-specific
    { term: 'check', bidirectional: false, weight: 0.5 },  // generic - don't expand check → test
    { term: 'verify', bidirectional: false, weight: 0.5 }, // generic - don't expand verify → test
    { term: 'assert', bidirectional: false, weight: 0.6 }, // somewhat specific
  ]),
  simpleEntry('mock', 'patterns', ['stub', 'fake', 'spy', 'double']),
  simpleEntry('fixture', 'patterns', ['setup', 'testdata', 'test_data', 'sample']),

  // ============================================
  // COLLECTIONS
  // ============================================
  simpleEntry('array', 'data', ['list', 'collection', 'items', 'elements']),
  simpleEntry('map', 'data', ['dict', 'dictionary', 'hash', 'object', 'record']),
  simpleEntry('set', 'data', ['unique', 'distinct', 'collection']),
  simpleEntry('stack', 'data', ['lifo', 'push', 'pop']),
  simpleEntry('tree', 'data', ['node', 'branch', 'leaf', 'hierarchy']),
  simpleEntry('graph', 'data', ['network', 'edges', 'vertices', 'nodes']),

  // ============================================
  // FILE OPERATIONS
  // ============================================
  simpleEntry('read', 'data', ['load', 'open', 'input', 'import']),
  simpleEntry('write', 'data', ['save', 'output', 'export', 'store']),
  simpleEntry('append', 'data', ['add', 'concat', 'extend']),
  simpleEntry('copy', 'data', ['clone', 'duplicate', 'replicate']),
  simpleEntry('move', 'data', ['rename', 'relocate', 'transfer']),

  // ============================================
  // STATE MANAGEMENT
  // ============================================
  simpleEntry('state', 'patterns', ['store', 'data', 'context', 'snapshot']),
  simpleEntry('reducer', 'patterns', ['handler', 'processor', 'mutator']),
  simpleEntry('action', 'patterns', ['event', 'command', 'dispatch', 'intent']),
  simpleEntry('selector', 'patterns', ['getter', 'query', 'derive', 'computed']),

  // ============================================
  // NETWORK
  // ============================================
  simpleEntry('connect', 'http', ['open', 'establish', 'link', 'attach']),
  simpleEntry('disconnect', 'http', ['close', 'terminate', 'detach', 'unlink']),
  simpleEntry('send', 'http', ['transmit', 'emit', 'dispatch', 'post']),
  simpleEntry('receive', 'http', ['get', 'accept', 'read', 'listen']),
  simpleEntry('socket', 'http', ['connection', 'channel', 'stream', 'websocket', 'ws']),
];

/**
 * Get all synonyms as a flat map for quick lookup
 */
export function getSynonymMap(): Map<string, SynonymEntry> {
  const map = new Map<string, SynonymEntry>();
  for (const entry of DEFAULT_SYNONYMS) {
    map.set(entry.canonical.toLowerCase(), entry);
    // Also map each synonym back to its entry for bidirectional lookup
    for (const syn of entry.synonyms) {
      if (syn.bidirectional && !map.has(syn.term.toLowerCase())) {
        map.set(syn.term.toLowerCase(), entry);
      }
    }
  }
  return map;
}

/**
 * Find all matching entries for a term
 */
export function findSynonymEntries(term: string): SynonymEntry[] {
  const normalizedTerm = term.toLowerCase();
  const matches: SynonymEntry[] = [];

  for (const entry of DEFAULT_SYNONYMS) {
    if (entry.canonical.toLowerCase() === normalizedTerm) {
      matches.push(entry);
      continue;
    }

    for (const syn of entry.synonyms) {
      if (syn.term.toLowerCase() === normalizedTerm && syn.bidirectional) {
        matches.push(entry);
        break;
      }
    }
  }

  return matches;
}
