export { generateFixPacks, findingsToPatches } from "./patchBuilder";
export type { GeneratedPatch, FindingInput } from "./patchBuilder";
export { buildRoadmap } from "./roadmapBuilder";
export {
  applyFixes,
  checkCleanWorkingTree,
  createBackupRef,
  validatePatch,
  applyOnePatch,
} from "./apply-fixes";
export type { ApplyFixesOptions, ApplyFixesResult } from "./apply-fixes";
