/**
 * enterprise/index.ts — barrel shim for sub-domain testability.
 *
 * Re-exports every named export from the parent enterprise.ts so that
 * individual domain functions (analyzeApiContracts, analyzeObservability, …)
 * can be imported directly in unit tests without instantiating the full
 * runEnterpriseAnalysis orchestrator.
 *
 * Usage in tests:
 *   import { analyzeApiContracts } from '../enterprise';
 *   import { analyzeObservability } from '../enterprise';
 */
export {
  analyzeApiContracts,
  analyzeObservability,
  analyzeBuildCI,
  analyzeCoupling,
  analyzeLicenseCompliance,
  analyzeLongTermDebt,
  runEnterpriseAnalysis,
  type ApiContractFinding,
  type ObservabilityFinding,
  type BuildCIFinding,
  type CouplingFinding,
  type LicenseFinding,
  type LongTermDebtFinding,
  type EnterpriseReport,
} from '../enterprise';
