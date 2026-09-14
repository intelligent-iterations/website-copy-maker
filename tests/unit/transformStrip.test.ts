import { describe, expect, it } from "vitest";
import { stripTranslation } from "../../src/generate/utils/transformStrip.js";

describe("stripTranslation", () => {
  it("returns empty for none / empty / undefined", () => {
    expect(stripTranslation(undefined)).toBe("");
    expect(stripTranslation(null)).toBe("");
    expect(stripTranslation("")).toBe("");
    expect(stripTranslation("none")).toBe("");
    expect(stripTranslation("  none  ")).toBe("");
  });

  it("drops a pure-translation matrix (a=d=1, b=c=0, tx/ty)", () => {
    // The exact bug from the the example site social icons.
    expect(stripTranslation("matrix(1, 0, 0, 1, -204, 0)")).toBe("");
    expect(stripTranslation("matrix(1, 0, 0, 1, 50, 100)")).toBe("");
  });

  it("zeroes tx/ty in a rotation matrix while preserving the rotation", () => {
    // 45° rotation matrix (cos45 = sin45 = 0.707...).
    const rotated45 = stripTranslation("matrix(0.707, 0.707, -0.707, 0.707, 10, 20)");
    expect(rotated45).toBe("matrix(0.707, 0.707, -0.707, 0.707, 0, 0)");
  });

  it("drops translate / translateX / translateY entirely", () => {
    expect(stripTranslation("translate(10px, 20px)")).toBe("");
    expect(stripTranslation("translateX(-50%)")).toBe("");
    expect(stripTranslation("translateY(100px)")).toBe("");
    expect(stripTranslation("translate3d(10px, 20px, 0)")).toBe("");
  });

  it("preserves rotate / scale / skew unchanged", () => {
    expect(stripTranslation("rotate(15deg)")).toBe("rotate(15deg)");
    expect(stripTranslation("scale(1.2)")).toBe("scale(1.2)");
    expect(stripTranslation("scale(1.2) rotate(45deg)")).toBe("scale(1.2) rotate(45deg)");
    expect(stripTranslation("skew(10deg, 5deg)")).toBe("skew(10deg, 5deg)");
  });

  it("keeps rotate but drops translate when chained", () => {
    expect(stripTranslation("rotate(15deg) translate(10px, 5px)")).toBe("rotate(15deg)");
    expect(stripTranslation("translate(10px, 5px) rotate(15deg)")).toBe("rotate(15deg)");
    expect(stripTranslation("rotate(15deg) translateX(-20px) scale(1.1)")).toBe(
      "rotate(15deg) scale(1.1)",
    );
  });

  it("strips matrix3d translation (positions 13/14) while preserving rotation", () => {
    // Identity rotation/scale + translation (10,20,0) → empty.
    expect(stripTranslation("matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 10,20,0,1)")).toBe("");
    // A 45° rotation matrix3d with translation: zero out tx/ty, keep rotation.
    const r3d = stripTranslation("matrix3d(0.707,0.707,0,0, -0.707,0.707,0,0, 0,0,1,0, 10,20,0,1)");
    expect(r3d).toContain("matrix3d(");
    // tx (position 12) and ty (position 13) are zeroed.
    expect(r3d).toContain("0, 0, 0, 1");
    // Rotation values are preserved.
    expect(r3d).toContain("0.707");
  });

  it("drops unknown functions conservatively", () => {
    // mystery() is unknown → drop. Ensures we never leak unbounded
    // translation hidden inside a name we don't recognize.
    expect(stripTranslation("mystery(123)")).toBe("");
    expect(stripTranslation("rotate(15deg) mystery(123)")).toBe("rotate(15deg)");
  });
});
