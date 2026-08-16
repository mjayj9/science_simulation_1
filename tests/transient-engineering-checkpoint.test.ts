import { describe, expect, it } from "vitest";
import { acceptExactTransientEngineeringCheckpoint } from
  "../scripts/transient-engineering-checkpoint";

describe("transient-engineering durable checkpoint provenance", () => {
  it("never promotes legacy tasks under a new computation fingerprint", () => {
    const legacyFingerprint =
      "0574cdf3545ce2be0b2be0ef85f37cde5a73908b2abd54fd6f54b86cfbdcab25";
    const currentFingerprint =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const legacy = {
      schemaVersion: 2,
      fingerprint: legacyFingerprint,
      tasks: { "annual:static:plane": { validationPass: true } },
    };

    expect(acceptExactTransientEngineeringCheckpoint(legacy, currentFingerprint))
      .toBeUndefined();
    expect(acceptExactTransientEngineeringCheckpoint(
      { ...legacy, fingerprint: currentFingerprint }, currentFingerprint,
    )).toEqual({ ...legacy, fingerprint: currentFingerprint });
    expect(acceptExactTransientEngineeringCheckpoint(
      { ...legacy, schemaVersion: 1, fingerprint: currentFingerprint }, currentFingerprint,
    )).toBeUndefined();
  });
});
