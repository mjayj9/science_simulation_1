import {
  isSimulationEventStale,
  type SimulationRunRequest,
  type SimulationWorkerEvent,
} from "../workers/protocol";

type ActiveAnnualRequest = Pick<SimulationRunRequest, "requestId" | "fingerprint">;

/**
 * Accept an event only from the worker/request pair that is authoritative now.
 * A terminated worker can still have a message queued on the browser event loop.
 */
export function acceptsAnnualWorkerEvent(
  sourceWorker: object,
  activeWorker: object | null,
  event: SimulationWorkerEvent,
  activeRequest: ActiveAnnualRequest | null,
): boolean {
  return sourceWorker === activeWorker
    && activeRequest !== null
    && !isSimulationEventStale(event, activeRequest);
}
