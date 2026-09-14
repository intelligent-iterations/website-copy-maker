import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli.js";

describe("parseArgs", () => {
  it("parses required flags (default mode is responsive)", () => {
    const flags = parseArgs([
      "--adapter",
      "next-tailwind",
      "--url",
      "https://example.com",
      "--out",
      "./rebuilt",
      "--state-dir",
      "./runs",
    ]);
    expect(flags.adapter).toBe("next-tailwind");
    expect(flags.url).toBe("https://example.com");
    expect(flags.out).toBe("./rebuilt");
    expect(flags.mode).toBe("responsive");
    expect(flags.maxIterations).toBe(6);
  });

  it("accepts --mode semantic", () => {
    const flags = parseArgs([
      "--url",
      "https://example.com",
      "--out",
      "./out",
      "--mode",
      "semantic",
      "--adapter",
      "next-tailwind",
      "--state-dir",
      "./runs",
    ]);
    expect(flags.mode).toBe("semantic");
  });

  it("rejects an invalid --mode", () => {
    expect(() =>
      parseArgs([
        "--adapter",
        "next-tailwind",
        "--url",
        "https://example.com",
        "--out",
        "./out",
        "--mode",
        "magic",
        "--state-dir",
        "./runs",
      ]),
    ).toThrow(/Invalid --mode/);
  });

  it("accepts --max-iterations", () => {
    const flags = parseArgs([
      "--url",
      "https://example.com",
      "--out",
      "./out",
      "--max-iterations",
      "3",
      "--adapter",
      "next-tailwind",
      "--state-dir",
      "./runs",
    ]);
    expect(flags.maxIterations).toBe(3);
  });

  it("rejects --skip-qa: the QA gate is mandatory and cannot be skipped", () => {
    // yargs strict mode rejects unknown flags. In a non-CLI context it triggers
    // process.exit(1), which vitest surfaces as a thrown error - either signal
    // confirms the flag is no longer accepted.
    expect(() =>
      parseArgs([
        "--adapter",
        "next-tailwind",
        "--url",
        "https://example.com",
        "--out",
        "./out",
        "--skip-qa",
        "--state-dir",
        "./runs",
      ]),
    ).toThrow(/Unknown argument|process\.exit/i);
  });

  it("requires the output adapter to be explicit", () => {
    expect(() =>
      parseArgs(["--url", "https://example.com", "--out", "./out", "--state-dir", "./runs"]),
    ).toThrow();
  });

  it("rejects unknown output adapters", () => {
    expect(() =>
      parseArgs([
        "--adapter",
        "cloud-host",
        "--url",
        "https://example.com",
        "--out",
        "./out",
        "--state-dir",
        "./runs",
      ]),
    ).toThrow(/Invalid --adapter/);
  });

  it("requires an explicit artifact root for the adapter", () => {
    expect(() =>
      parseArgs(["--adapter", "next-tailwind", "--url", "https://example.com", "--out", "./out"]),
    ).toThrow();
  });
});
