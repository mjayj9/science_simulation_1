import { describe, expect, it } from "vitest";
import { acceptsAnnualWorkerEvent } from "../src/ui/annual-worker-guard";
import {
  SIMULATION_WORKER_PROTOCOL_VERSION,
  type SimulationRunRequest,
  type SimulationWorkerEvent,
} from "../src/workers/protocol";

function request(id: string, fingerprint: string): Pick<SimulationRunRequest, "requestId" | "fingerprint"> {
  return { requestId: id, fingerprint };
}

function acceptedEvent(id: string, fingerprint: string): SimulationWorkerEvent {
  return {
    protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
    type: "simulation/accepted",
    requestId: id,
    fingerprint,
    mode: "annual",
  };
}

describe("annual worker event authority", () => {
  it("rejects a queued completion path from a superseded fake worker", () => {
    const oldWorker = {};
    const currentWorker = {};
    const oldRequest = request("annual-compare", "old-fingerprint");
    const currentRequest = request("annual-compare", "new-fingerprint");

    expect(acceptsAnnualWorkerEvent(
      oldWorker,
      currentWorker,
      acceptedEvent(oldRequest.requestId, oldRequest.fingerprint),
      currentRequest,
    )).toBe(false);
    expect(acceptsAnnualWorkerEvent(
      currentWorker,
      currentWorker,
      acceptedEvent(currentRequest.requestId, currentRequest.fingerprint),
      currentRequest,
    )).toBe(true);
    expect(acceptsAnnualWorkerEvent(
      currentWorker,
      currentWorker,
      acceptedEvent(oldRequest.requestId, oldRequest.fingerprint),
      currentRequest,
    )).toBe(false);
    expect(acceptsAnnualWorkerEvent(
      currentWorker,
      currentWorker,
      acceptedEvent(currentRequest.requestId, currentRequest.fingerprint),
      null,
    )).toBe(false);
  });
});
