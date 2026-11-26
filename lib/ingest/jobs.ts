// lib/ingest/jobs.ts — registry of the six light jobs (cron routes + scripts/run-job.ts) (W4).
import { run as aa } from './aa';
import { run as arena } from './arena';
import { run as calibrate } from './calibrate';
import { run as epoch } from './epoch';
import { run as livebench } from './livebench';
import { JOB_SOURCES, type JobOptions, type JobResult, type JobSource } from './log';
import { run as openrouter } from './openrouter';

export const JOBS: Record<JobSource, (opts?: JobOptions) => Promise<JobResult>> = { openrouter, aa, arena, livebench, epoch, calibrate };
export { JOB_SOURCES, type JobOptions, type JobResult, type JobSource };
