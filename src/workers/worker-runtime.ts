import { runSimulationKernel, SimulationCancelledError } from "./kernel";
import {
  SIMULATION_WORKER_PROTOCOL_VERSION,
  serializeWorkerError,
  type SimulationCancelRequest,
  type SimulationRunRequest,
  type SimulationWorkerEvent,
  type SimulationWorkerRequest,
} from "./protocol";

type EventEmitter = (event: SimulationWorkerEvent) => void;
type KernelRunner = typeof runSimulationKernel;

interface ActiveJob {
  request: SimulationRunRequest;
  cancelled: boolean;
  cancelReason?: string;
  supersededBy?: string;
  completed: number;
  total: number;
  completedWork: number;
  totalWork: number;
}

/**
 * Pure worker runtime, separated from the `self` binding for unit tests and
 * alternative worker hosts. One requestId identifies one replaceable slot;
 * a new fingerprint supersedes an older run in that slot.
 */
export class SimulationWorkerRuntime {
  private readonly active = new Map<string, ActiveJob>();

  constructor(
    private readonly emit: EventEmitter,
    private readonly runKernel: KernelRunner = runSimulationKernel,
  ) {}

  get activeCount(): number {
    return this.active.size;
  }

  handleRequest(request: SimulationWorkerRequest): Promise<void> {
    if (request.type === "simulation/cancel") {
      this.cancel(request);
      return Promise.resolve();
    }
    return this.execute(request);
  }

  private cancel(request: SimulationCancelRequest): void {
    const job = this.active.get(request.requestId);
    if (!job) {
      this.emit({
        protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
        type: "simulation/stale",
        requestId: request.requestId,
        fingerprint: request.fingerprint,
        reason: "request-not-active",
      });
      return;
    }
    if (job.request.fingerprint !== request.fingerprint) {
      this.emit({
        protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
        type: "simulation/stale",
        requestId: request.requestId,
        fingerprint: request.fingerprint,
        currentFingerprint: job.request.fingerprint,
        reason: "cancel-fingerprint-mismatch",
      });
      return;
    }
    job.cancelled = true;
    job.cancelReason = request.reason;
  }

  private async execute(request: SimulationRunRequest): Promise<void> {
    const existing = this.active.get(request.requestId);
    if (existing?.request.fingerprint === request.fingerprint) {
      this.emit({
        protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
        type: "simulation/error",
        requestId: request.requestId,
        fingerprint: request.fingerprint,
        error: {
          name: "DuplicateRequestError",
          message: "같은 requestId와 fingerprint의 작업이 이미 실행 중입니다.",
        },
      });
      return;
    }
    if (existing) {
      existing.cancelled = true;
      existing.supersededBy = request.fingerprint;
    }

    const job: ActiveJob = {
      request,
      cancelled: false,
      completed: 0,
      total: request.input.weather.length,
      completedWork: 0,
      totalWork: request.input.weather.length,
    };
    this.active.set(request.requestId, job);
    this.emit({
      protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
      type: "simulation/accepted",
      requestId: request.requestId,
      fingerprint: request.fingerprint,
      mode: request.input.mode ?? "time-series",
    });

    try {
      const complete = await this.runKernel(request, {
        isCancelled: () => job.cancelled,
        onChunk: (event) => {
          if (this.active.get(request.requestId) === job) this.emit(event);
        },
        onProgress: (event) => {
          job.completed = event.completed;
          job.total = event.total;
          job.completedWork = event.completedWork;
          job.totalWork = event.totalWork;
          if (this.active.get(request.requestId) === job) this.emit(event);
        },
      });
      if (this.active.get(request.requestId) === job && !job.cancelled) {
        this.emit(complete);
      }
    } catch (error) {
      if (job.supersededBy) {
        this.emit({
          protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
          type: "simulation/stale",
          requestId: request.requestId,
          fingerprint: request.fingerprint,
          currentFingerprint: job.supersededBy,
          reason: "superseded",
        });
      } else if (error instanceof SimulationCancelledError || job.cancelled) {
        this.emit({
          protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
          type: "simulation/cancelled",
          requestId: request.requestId,
          fingerprint: request.fingerprint,
          completed: job.completed,
          total: job.total,
          completedWork: job.completedWork,
          totalWork: job.totalWork,
          fraction: job.totalWork > 0 ? job.completedWork / job.totalWork : 0,
          ...(job.cancelReason ? { reason: job.cancelReason } : {}),
        });
      } else if (this.active.get(request.requestId) === job) {
        this.emit({
          protocolVersion: SIMULATION_WORKER_PROTOCOL_VERSION,
          type: "simulation/error",
          requestId: request.requestId,
          fingerprint: request.fingerprint,
          error: serializeWorkerError(error),
        });
      }
    } finally {
      if (this.active.get(request.requestId) === job) {
        this.active.delete(request.requestId);
      }
    }
  }
}
