/// <reference lib="webworker" />

import { SIMULATION_WORKER_PROTOCOL_VERSION, type SimulationWorkerRequest } from "./protocol";
import { SimulationWorkerRuntime } from "./worker-runtime";

const runtime = new SimulationWorkerRuntime((event) => self.postMessage(event));

function isWorkerRequest(value: unknown): value is SimulationWorkerRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SimulationWorkerRequest>;
  return (
    candidate.protocolVersion === SIMULATION_WORKER_PROTOCOL_VERSION &&
    (candidate.type === "simulation/run" || candidate.type === "simulation/cancel") &&
    typeof candidate.requestId === "string" &&
    typeof candidate.fingerprint === "string"
  );
}

self.addEventListener("message", (message: MessageEvent<unknown>) => {
  if (!isWorkerRequest(message.data)) return;
  void runtime.handleRequest(message.data);
});

export {};
