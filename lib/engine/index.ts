// lib/engine/index.ts — public engine API (SPEC "Engine signatures"). Pure TypeScript, safe on client and server.
export { K, median } from './constants';
export { METRICS, val, theilSen, fitCalibrations, scoreModels } from './scores';
export { recommend } from './recommend';
export { specFromPicks, fitFile, fitModel, fastMemoryGb, spillMemoryGb, physicalCeilingTps, isMoe } from './hardware';
export { quantView } from './quants';
export { fitEta } from './eta';
