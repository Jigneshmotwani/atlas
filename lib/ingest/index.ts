// lib/ingest — source clients, matching and insert-on-change writers (W4). Server / scripts only.
export { normalizeName, stripEffort, slugify, creatorIdFor, cleanDisplayName } from './normalize';
export { IngestContext, TOL, FACT_KEYS, type Tolerance, type FactTable, type MatchOptions } from './context';
export { logRun, Skip, JOB_SOURCES, type JobResult, type JobOptions, type JobSource } from './log';
export { JOBS } from './jobs';
export { SOURCES } from './sources';
