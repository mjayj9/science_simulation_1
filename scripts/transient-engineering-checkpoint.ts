export interface TransientEngineeringDurableCheckpoint {
  schemaVersion: 2;
  fingerprint: string;
  tasks: Record<string, unknown>;
}

/**
 * Accept only checkpoints produced by the exact current computation contract.
 * There is intentionally no legacy migration: old tasks cannot prove the
 * source/configuration fingerprint under which their numbers were computed.
 */
export function acceptExactTransientEngineeringCheckpoint(
  value: unknown,
  currentFingerprint: string,
): TransientEngineeringDurableCheckpoint | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source.schemaVersion !== 2 || source.fingerprint !== currentFingerprint
    || source.tasks === null || typeof source.tasks !== "object" || Array.isArray(source.tasks)) {
    return undefined;
  }
  return {
    schemaVersion: 2,
    fingerprint: currentFingerprint,
    tasks: source.tasks as Record<string, unknown>,
  };
}
