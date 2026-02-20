/**
 * Markov chain builders for different relationship types
 */

import type { SqliteStorage } from '../../indexer/storage/sqlite.js';
import type {
  ChainType,
  CallFlowChainConfig,
  CooccurrenceChainConfig,
  TypeAffinityChainConfig,
  ImportClusterChainConfig,
} from '../types.js';
import {
  DEFAULT_CALL_FLOW_CONFIG,
  DEFAULT_COOCCURRENCE_CONFIG,
  DEFAULT_TYPE_AFFINITY_CONFIG,
  DEFAULT_IMPORT_CLUSTER_CONFIG,
} from '../types.js';

interface TransitionMap {
  get(from: string): Map<string, number> | undefined;
  set(from: string, value: Map<string, number>): void;
  entries(): IterableIterator<[string, Map<string, number>]>;
}

function createTransitionMap(): TransitionMap {
  return new Map<string, Map<string, number>>();
}

function addTransition(map: TransitionMap, from: string, to: string, weight: number): void {
  if (!map.get(from)) {
    map.set(from, new Map());
  }
  const current = map.get(from)!.get(to) ?? 0;
  map.get(from)!.set(to, current + weight);
}

function normalizeAndSave(
  storage: SqliteStorage,
  chainId: string,
  transitionMap: TransitionMap,
  stateNames: Map<string, string>
): Array<{
  fromStateId: string;
  fromStateName: string;
  toStateId: string;
  toStateName: string;
  rawCount: number;
  probability: number;
}> {
  const transitions: Array<{
    fromStateId: string;
    fromStateName: string;
    toStateId: string;
    toStateName: string;
    rawCount: number;
    probability: number;
  }> = [];

  for (const [fromState, toStates] of transitionMap.entries()) {
    // Calculate row sum for normalization
    let rowSum = 0;
    for (const weight of toStates.values()) {
      rowSum += weight;
    }

    if (rowSum === 0) continue;

    for (const [toState, weight] of toStates.entries()) {
      transitions.push({
        fromStateId: fromState,
        fromStateName: stateNames.get(fromState) ?? fromState,
        toStateId: toState,
        toStateName: stateNames.get(toState) ?? toState,
        rawCount: weight,
        probability: weight / rowSum,
      });
    }
  }

  return transitions;
}

/**
 * Build the call flow chain from co-caller patterns
 */
export async function buildCallFlowChain(
  storage: SqliteStorage,
  config: Partial<CallFlowChainConfig> = {}
): Promise<string> {
  const fullConfig = { ...DEFAULT_CALL_FLOW_CONFIG, ...config };
  const chainId = await storage.getOrCreateChain('call_flow');
  await storage.clearChain(chainId);

  const callEdges = await storage.getAllCallGraphEdges();
  const transitionMap = createTransitionMap();
  const stateNames = new Map<string, string>();

  // Group edges by caller to find co-callees
  const callerToCallees = new Map<string, Array<{
    calleeId: string;
    calleeName: string;
    callCount: number;
    isAsync: boolean;
    isConditional: boolean;
  }>>();

  for (const edge of callEdges) {
    if (!callerToCallees.has(edge.callerSymbolId)) {
      callerToCallees.set(edge.callerSymbolId, []);
    }
    callerToCallees.get(edge.callerSymbolId)!.push({
      calleeId: edge.calleeSymbolId ?? edge.calleeName,
      calleeName: edge.calleeName,
      callCount: edge.callCount,
      isAsync: edge.isAsync,
      isConditional: edge.isConditional,
    });
    stateNames.set(edge.calleeSymbolId ?? edge.calleeName, edge.calleeName);
  }

  // Build co-caller relationships
  for (const [_callerId, callees] of callerToCallees.entries()) {
    const fanout = callees.length;
    if (fanout < 2) continue;

    const fanoutFactor = fullConfig.fanoutNormalization ? Math.sqrt(fanout - 1) : 1;

    for (const calleeA of callees) {
      for (const calleeB of callees) {
        if (calleeA.calleeId === calleeB.calleeId) continue;
        if (calleeA.callCount < fullConfig.minCallCount) continue;
        if (calleeB.callCount < fullConfig.minCallCount) continue;

        let weight: number;
        if (fullConfig.useGeometricMean) {
          const logCountA = Math.log(1 + calleeA.callCount);
          const logCountB = Math.log(1 + calleeB.callCount);
          weight = Math.sqrt(logCountA * logCountB) / fanoutFactor;
        } else {
          weight = Math.min(calleeA.callCount, calleeB.callCount) / fanoutFactor;
        }

        // Apply modifiers
        if (calleeB.isAsync) {
          weight *= 1 + fullConfig.asyncBonus;
        }
        if (calleeB.isConditional) {
          weight *= 1 - fullConfig.conditionalPenalty;
        }

        addTransition(transitionMap, calleeA.calleeId, calleeB.calleeId, weight);
      }
    }
  }

  const transitions = normalizeAndSave(storage, chainId, transitionMap, stateNames);
  await storage.saveTransitions(chainId, transitions);

  return chainId;
}

/**
 * Build the co-occurrence chain from symbols appearing together
 */
export async function buildCooccurrenceChain(
  storage: SqliteStorage,
  config: Partial<CooccurrenceChainConfig> = {}
): Promise<string> {
  const fullConfig = { ...DEFAULT_COOCCURRENCE_CONFIG, ...config };
  const chainId = await storage.getOrCreateChain('cooccurrence');
  await storage.clearChain(chainId);

  const files = await storage.listFiles();
  const transitionMap = createTransitionMap();
  const stateNames = new Map<string, string>();

  // Count document frequency for IDF
  const docFrequency = new Map<string, number>();
  const totalDocs = files.length;

  for (const file of files) {
    const symbolIds = new Set<string>();

    for (const func of file.functions) {
      symbolIds.add(func.id);
      stateNames.set(func.id, func.name);
    }
    for (const cls of file.classes) {
      symbolIds.add(cls.id);
      stateNames.set(cls.id, cls.name);
      for (const method of cls.methods) {
        symbolIds.add(method.id);
        stateNames.set(method.id, `${cls.name}.${method.name}`);
      }
    }

    for (const id of symbolIds) {
      docFrequency.set(id, (docFrequency.get(id) ?? 0) + 1);
    }
  }

  // Build co-occurrence from each file
  for (const file of files) {
    const symbols: Array<{ id: string; name: string; parentId?: string }> = [];

    for (const func of file.functions) {
      symbols.push({ id: func.id, name: func.name });
    }

    for (const cls of file.classes) {
      symbols.push({ id: cls.id, name: cls.name });
      for (const method of cls.methods) {
        symbols.push({ id: method.id, name: method.name, parentId: cls.id });
      }
    }

    // Create symmetric co-occurrence edges
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const symA = symbols[i];
        const symB = symbols[j];
        if (!symA || !symB) continue;

        // Determine scope weight
        let scopeWeight = fullConfig.sameFileWeight;
        if (symA.parentId && symA.parentId === symB.parentId) {
          scopeWeight = fullConfig.sameClassWeight;
        }

        // Apply IDF weighting
        let weight = scopeWeight;
        if (fullConfig.useIdfWeighting) {
          const idfA = Math.log(totalDocs / (docFrequency.get(symA.id) ?? 1));
          const idfB = Math.log(totalDocs / (docFrequency.get(symB.id) ?? 1));
          weight *= Math.sqrt(idfA * idfB);
        }

        // Symmetric: add both directions
        addTransition(transitionMap, symA.id, symB.id, weight);
        addTransition(transitionMap, symB.id, symA.id, weight);
      }
    }
  }

  const transitions = normalizeAndSave(storage, chainId, transitionMap, stateNames);
  await storage.saveTransitions(chainId, transitions);

  return chainId;
}

/**
 * Build the type affinity chain from inheritance relationships
 */
export async function buildTypeAffinityChain(
  storage: SqliteStorage,
  config: Partial<TypeAffinityChainConfig> = {}
): Promise<string> {
  const fullConfig = { ...DEFAULT_TYPE_AFFINITY_CONFIG, ...config };
  const chainId = await storage.getOrCreateChain('type_affinity');
  await storage.clearChain(chainId);

  const relationships = await storage.getAllTypeRelationships();
  const transitionMap = createTransitionMap();
  const stateNames = new Map<string, string>();

  for (const rel of relationships) {
    stateNames.set(rel.sourceSymbolId, rel.sourceName);
    if (rel.targetSymbolId) {
      stateNames.set(rel.targetSymbolId, rel.targetName);
    }

    let weight: number;
    switch (rel.relationshipKind) {
      case 'extends':
        weight = fullConfig.extendsWeight;
        break;
      case 'implements':
        weight = fullConfig.implementsWeight;
        break;
      case 'mixin':
        weight = fullConfig.mixinWeight;
        break;
      default:
        weight = 0.5;
    }

    const targetId = rel.targetSymbolId ?? rel.targetName;

    // Bidirectional: source relates to target, target relates to source
    addTransition(transitionMap, rel.sourceSymbolId, targetId, weight);
    addTransition(transitionMap, targetId, rel.sourceSymbolId, weight * 0.8);
  }

  const transitions = normalizeAndSave(storage, chainId, transitionMap, stateNames);
  await storage.saveTransitions(chainId, transitions);

  return chainId;
}

/**
 * Build the import cluster chain from import patterns
 */
export async function buildImportClusterChain(
  storage: SqliteStorage,
  config: Partial<ImportClusterChainConfig> = {}
): Promise<string> {
  const fullConfig = { ...DEFAULT_IMPORT_CLUSTER_CONFIG, ...config };
  const chainId = await storage.getOrCreateChain('import_cluster');
  await storage.clearChain(chainId);

  const files = await storage.listFiles();
  const transitionMap = createTransitionMap();
  const stateNames = new Map<string, string>();

  // Map import sources to files that import them
  const sourceToFiles = new Map<string, string[]>();

  for (const file of files) {
    stateNames.set(file.filePath, file.relativePath);

    for (const imp of file.imports) {
      if (!sourceToFiles.has(imp.source)) {
        sourceToFiles.set(imp.source, []);
      }
      sourceToFiles.get(imp.source)!.push(file.filePath);
    }
  }

  // Build relationships based on shared imports
  const fileToSharedImports = new Map<string, Map<string, number>>();

  for (const [_source, importingFiles] of sourceToFiles.entries()) {
    if (importingFiles.length < 2) continue;

    for (let i = 0; i < importingFiles.length; i++) {
      for (let j = i + 1; j < importingFiles.length; j++) {
        const fileA = importingFiles[i];
        const fileB = importingFiles[j];
        if (!fileA || !fileB) continue;

        if (!fileToSharedImports.has(fileA)) {
          fileToSharedImports.set(fileA, new Map());
        }
        if (!fileToSharedImports.has(fileB)) {
          fileToSharedImports.set(fileB, new Map());
        }

        const mapA = fileToSharedImports.get(fileA)!;
        const mapB = fileToSharedImports.get(fileB)!;

        mapA.set(fileB, (mapA.get(fileB) ?? 0) + 1);
        mapB.set(fileA, (mapB.get(fileA) ?? 0) + 1);
      }
    }
  }

  // Add transitions for files with enough shared imports
  for (const [fileA, related] of fileToSharedImports.entries()) {
    for (const [fileB, sharedCount] of related.entries()) {
      if (sharedCount >= fullConfig.minSharedImports) {
        const weight = sharedCount * fullConfig.sharedSourceWeight;
        addTransition(transitionMap, fileA, fileB, weight);
      }
    }
  }

  const transitions = normalizeAndSave(storage, chainId, transitionMap, stateNames);
  await storage.saveTransitions(chainId, transitions);

  return chainId;
}

/**
 * Build all chains
 */
export async function buildAllChains(
  storage: SqliteStorage,
  chainTypes: ChainType[] = ['call_flow', 'cooccurrence', 'type_affinity', 'import_cluster']
): Promise<string[]> {
  const builtChains: string[] = [];

  for (const chainType of chainTypes) {
    let chainId: string;
    switch (chainType) {
      case 'call_flow':
        chainId = await buildCallFlowChain(storage);
        break;
      case 'cooccurrence':
        chainId = await buildCooccurrenceChain(storage);
        break;
      case 'type_affinity':
        chainId = await buildTypeAffinityChain(storage);
        break;
      case 'import_cluster':
        chainId = await buildImportClusterChain(storage);
        break;
    }
    builtChains.push(chainId);
  }

  return builtChains;
}
