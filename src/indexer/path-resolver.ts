/**
 * PathResolver - Resolves user-provided paths to absolute paths in the index
 */

import path from 'node:path';

export interface FilePathInfo {
  filePath: string;
  relativePath: string;
}

export type ResolveErrorType = 'not_found' | 'ambiguous';

export interface ResolveError {
  type: ResolveErrorType;
  message: string;
  suggestions?: string[];
  /** Available files in the nearest matching directory (for autocomplete) */
  availablePaths?: string[];
  /** The directory that was searched for available paths */
  searchedDirectory?: string;
}

export interface ResolveOptions {
  /** When true, auto-selects a single high-confidence match. Default: true */
  autoResolve?: boolean;
  /** Minimum score (0-100) required for auto-resolution. Default: 80 */
  minAutoResolveScore?: number;
}

export type ResolveResult =
  | { success: true; result: { resolvedPath: string; relativePath: string; autoResolved?: boolean; originalInput?: string } }
  | { success: false; error: ResolveError };

/**
 * Resolves user-provided paths to absolute paths stored in the index.
 * Supports multiple resolution strategies:
 * 1. Exact match (absolute paths)
 * 2. Resolve relative to rootDirectory
 * 3. Match against stored relative_path
 * 4. Suffix match for partial paths (with ambiguity detection)
 */
export class PathResolver {
  constructor(
    private rootDirectory: string,
    private getAllFilePaths: () => Promise<FilePathInfo[]>
  ) {}

  /**
   * Resolve a user-provided path to an absolute path in the index
   */
  async resolve(inputPath: string, options: ResolveOptions = {}): Promise<ResolveResult> {
    const { autoResolve = true, minAutoResolveScore = 80 } = options;
    const allFiles = await this.getAllFilePaths();

    // Create lookup maps for efficient searching
    const byAbsolutePath = new Map<string, FilePathInfo>();
    const byRelativePath = new Map<string, FilePathInfo>();

    for (const file of allFiles) {
      byAbsolutePath.set(file.filePath, file);
      byRelativePath.set(file.relativePath, file);
    }

    // Strategy 1: Exact match with absolute path
    if (path.isAbsolute(inputPath)) {
      const normalized = path.normalize(inputPath);
      const file = byAbsolutePath.get(normalized);
      if (file) {
        return {
          success: true,
          result: { resolvedPath: file.filePath, relativePath: file.relativePath },
        };
      }
    }

    // Strategy 2: Resolve relative to rootDirectory
    const resolvedFromRoot = path.resolve(this.rootDirectory, inputPath);
    const fileFromRoot = byAbsolutePath.get(resolvedFromRoot);
    if (fileFromRoot) {
      return {
        success: true,
        result: { resolvedPath: fileFromRoot.filePath, relativePath: fileFromRoot.relativePath },
      };
    }

    // Strategy 3: Match against stored relative_path
    const normalizedInput = inputPath.replace(/^\.\//, ''); // Remove leading ./
    const fileByRelative = byRelativePath.get(normalizedInput);
    if (fileByRelative) {
      return {
        success: true,
        result: { resolvedPath: fileByRelative.filePath, relativePath: fileByRelative.relativePath },
      };
    }

    // Strategy 4: Suffix match for partial paths
    const suffixMatches = allFiles.filter(file => {
      // Check if the file path ends with the input path
      const normalizedFile = file.filePath.replace(/\\/g, '/');
      const normalizedInputPath = inputPath.replace(/\\/g, '/');
      return normalizedFile.endsWith('/' + normalizedInputPath) ||
             normalizedFile.endsWith(normalizedInputPath) ||
             file.relativePath.endsWith('/' + normalizedInputPath) ||
             file.relativePath.endsWith(normalizedInputPath) ||
             file.relativePath === normalizedInputPath;
    });

    if (suffixMatches.length === 1) {
      const match = suffixMatches[0]!;
      return {
        success: true,
        result: { resolvedPath: match.filePath, relativePath: match.relativePath },
      };
    }

    if (suffixMatches.length > 1) {
      return {
        success: false,
        error: {
          type: 'ambiguous',
          message: `Multiple files match "${inputPath}". Please specify a more complete path.`,
          suggestions: suffixMatches.slice(0, 5).map(f => f.relativePath),
        },
      };
    }

    // No match found - try to provide helpful suggestions
    const scoredSuggestions = this.findSimilarPathsWithScores(inputPath, allFiles);

    // Auto-resolve if there's a single high-confidence match
    if (autoResolve && scoredSuggestions.length > 0) {
      const best = scoredSuggestions[0]!;
      const secondBest = scoredSuggestions[1];

      // Auto-resolve if:
      // 1. Best score exceeds threshold
      // 2. Either no second match, or second match is significantly lower
      if (
        best.score >= minAutoResolveScore &&
        (!secondBest || best.score - secondBest.score >= 20)
      ) {
        const file = allFiles.find(f => f.relativePath === best.path);
        if (file) {
          return {
            success: true,
            result: {
              resolvedPath: file.filePath,
              relativePath: file.relativePath,
              autoResolved: true,
              originalInput: inputPath,
            },
          };
        }
      }
    }

    // Get available paths in nearest directory for autocomplete
    const { availablePaths, searchedDirectory } = this.getPathsInNearestDirectory(inputPath, allFiles);

    return {
      success: false,
      error: {
        type: 'not_found',
        message: `File not found: "${inputPath}"`,
        suggestions: scoredSuggestions.length > 0 ? scoredSuggestions.map(s => s.path) : undefined,
        availablePaths: availablePaths.length > 0 ? availablePaths : undefined,
        searchedDirectory,
      },
    };
  }

  /**
   * Find similar paths using fuzzy matching for suggestions (returns paths only)
   */
  private findSimilarPaths(inputPath: string, allFiles: FilePathInfo[]): string[] {
    return this.findSimilarPathsWithScores(inputPath, allFiles).map(s => s.path);
  }

  /**
   * Find similar paths using fuzzy matching with scores
   * Returns scored suggestions sorted by relevance
   */
  private findSimilarPathsWithScores(
    inputPath: string,
    allFiles: FilePathInfo[]
  ): Array<{ path: string; score: number }> {
    const inputLower = inputPath.toLowerCase();
    const inputBasename = path.basename(inputPath).toLowerCase();
    const inputDir = path.dirname(inputPath).toLowerCase();

    // Score each file based on similarity
    const scored = allFiles.map(file => {
      const relativeLower = file.relativePath.toLowerCase();
      const basename = path.basename(file.relativePath).toLowerCase();
      const fileDir = path.dirname(file.relativePath).toLowerCase();
      let score = 0;

      // Exact basename match (strong signal)
      if (basename === inputBasename) {
        score += 100;
      }
      // Basename contains input
      else if (basename.includes(inputBasename)) {
        score += 50;
      }
      // Input contains basename
      else if (inputBasename.includes(basename)) {
        score += 30;
      }

      // Directory path similarity bonus
      if (inputDir !== '.' && fileDir.includes(inputDir)) {
        score += 25;
      }

      // Relative path contains input
      if (relativeLower.includes(inputLower)) {
        score += 20;
      }

      // Character-based similarity for basename
      score += this.similarityScore(basename, inputBasename) * 15;

      // Directory similarity bonus
      if (inputDir !== '.') {
        score += this.similarityScore(fileDir, inputDir) * 10;
      }

      return { path: file.relativePath, score };
    });

    // Sort by score and return top 5
    return scored
      .filter(s => s.score > 10)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }

  /**
   * Get available paths in the nearest matching directory
   * Used to show autocomplete suggestions when a path lookup fails
   */
  private getPathsInNearestDirectory(
    inputPath: string,
    allFiles: FilePathInfo[]
  ): { availablePaths: string[]; searchedDirectory?: string } {
    const inputDir = path.dirname(inputPath);

    // If input has a directory component, try to find files in that directory
    if (inputDir && inputDir !== '.') {
      const normalizedInputDir = inputDir.replace(/\\/g, '/').toLowerCase();

      // Find files whose directory matches or contains the input directory
      const matchingFiles = allFiles.filter(file => {
        const fileDir = path.dirname(file.relativePath).replace(/\\/g, '/').toLowerCase();
        return fileDir === normalizedInputDir ||
               fileDir.endsWith('/' + normalizedInputDir) ||
               fileDir.includes(normalizedInputDir);
      });

      if (matchingFiles.length > 0) {
        // Find the most common directory prefix among matches
        const dirCounts = new Map<string, number>();
        for (const file of matchingFiles) {
          const dir = path.dirname(file.relativePath);
          dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
        }

        // Get the directory with most files
        let bestDir = '';
        let maxCount = 0;
        for (const [dir, count] of dirCounts) {
          if (count > maxCount) {
            bestDir = dir;
            maxCount = count;
          }
        }

        // Return files in the best matching directory
        const filesInDir = matchingFiles
          .filter(f => path.dirname(f.relativePath) === bestDir)
          .map(f => f.relativePath)
          .slice(0, 15);

        return {
          availablePaths: filesInDir,
          searchedDirectory: bestDir,
        };
      }
    }

    return { availablePaths: [] };
  }

  /**
   * Get all paths in a specific directory
   */
  async getPathsInDirectory(directory: string): Promise<string[]> {
    const allFiles = await this.getAllFilePaths();
    const normalizedDir = directory.replace(/\\/g, '/').toLowerCase();

    return allFiles
      .filter(file => {
        const fileDir = path.dirname(file.relativePath).replace(/\\/g, '/').toLowerCase();
        return fileDir === normalizedDir || fileDir.startsWith(normalizedDir + '/');
      })
      .map(f => f.relativePath)
      .slice(0, 50);
  }

  /**
   * Simple similarity score (0-1) based on common characters
   */
  private similarityScore(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const setA = new Set(a.split(''));
    const setB = new Set(b.split(''));

    let common = 0;
    for (const char of setA) {
      if (setB.has(char)) common++;
    }

    return common / Math.max(setA.size, setB.size);
  }
}
