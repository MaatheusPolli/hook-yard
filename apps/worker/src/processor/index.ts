import type { WorkerEnv } from '../config.js';
import { HttpProcessor } from './http.processor.js';
import { SimulatedProcessor } from './simulated.processor.js';
import type { EventProcessor } from './types.js';

export function createProcessor(config: WorkerEnv): EventProcessor {
  if (config.PROCESSOR === 'http') {
    return new HttpProcessor({ url: config.PROCESSOR_HTTP_URL!, timeoutMs: config.PROCESSOR_HTTP_TIMEOUT_MS });
  }
  return new SimulatedProcessor({ failureRate: config.SIMULATED_FAILURE_RATE, latencyMs: config.SIMULATED_LATENCY_MS });
}
