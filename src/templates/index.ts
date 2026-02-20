/**
 * Template exports
 */

export { CANONICAL_RETRIEVAL_PIPELINE_BLOCK } from './canonical-retrieval-pipeline.js';

export {
  CLAUDE_MD_SECTION_MARKER,
  CLAUDE_MD_TEMPLATE,
  generateClaudeMdContent,
  hasLazyLoadingSection as hasClaudeMdSection,
} from './claude-md.js';

export {
  AGENTS_MD_SECTION_MARKER,
  AGENTS_MD_TEMPLATE,
  generateAgentsMdContent,
  hasLazyLoadingSection as hasAgentsMdSection,
} from './agents-md.js';
