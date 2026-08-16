import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VALIDATION_REPORT_LOCAL_LINKS } from "../scripts/validation-report-contract";

describe("validation report production links", () => {
  it("keeps every generated-report local target in the repository", () => {
    const missing = VALIDATION_REPORT_LOCAL_LINKS
      .map(([, href]) => href)
      .map((href) => resolve(process.cwd(), "docs", href))
      .filter((path) => !existsSync(path));
    expect(missing).toEqual([]);
  });
});
