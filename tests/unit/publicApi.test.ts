import { describe, expect, it } from "vitest";
import * as core from "../../src/index.js";
import * as nextTailwind from "../../src/next-tailwind.js";

describe("public API boundaries", () => {
  it("keeps the package root provider- and output-framework-neutral", () => {
    expect(core).toHaveProperty("captureReference");
    expect(core).toHaveProperty("evaluateReplica");
    expect(core).not.toHaveProperty("runAgent");
    expect(core).not.toHaveProperty("copyToNextTailwind");
  });

  it("exposes project generation only from the explicit adapter subpath", () => {
    expect(nextTailwind).toHaveProperty("copyToNextTailwind");
  });
});
