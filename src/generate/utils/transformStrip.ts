/**
 * Strip the translation component from CSS transform strings.
 *
 * The fidelity renderer captures element positions via getBoundingClientRect,
 * which returns POST-transform coordinates. Preserving the source's transform
 * verbatim then translates the element a second time, shifting it visibly off
 * (e.g. footer social icons gain a 204px left-shift on top of their already-
 * translated `left:` value).
 *
 * Solution: keep rotation, scale, skew, and 3D perspective; drop translation.
 *   - matrix(a, b, c, d, tx, ty) → matrix(a, b, c, d, 0, 0); empty if identity
 *   - matrix3d(...) → zero out positions 13/14 (tx/ty)
 *   - translate{,X,Y,3d}(...) → drop entirely
 *   - rotate / rotateZ / scale / scaleX / scaleY / skew / skewX / skewY /
 *     perspective → keep verbatim
 *   - chained transforms → split, strip each, rejoin (drop empties)
 *   - none / "" / undefined → ""
 */

const FN_RE = /([a-zA-Z][a-zA-Z0-9]*)\s*\(([^)]*)\)/g;
const KEEP = new Set([
  "rotate",
  "rotatex",
  "rotatey",
  "rotatez",
  "rotate3d",
  "scale",
  "scalex",
  "scaley",
  "scalez",
  "scale3d",
  "skew",
  "skewx",
  "skewy",
  "perspective",
]);
const TRANSLATE = new Set(["translate", "translatex", "translatey", "translatez", "translate3d"]);

export function stripTranslation(input: string | undefined | null): string {
  if (!input) return "";
  const trimmed = input.trim();
  if (trimmed === "" || trimmed === "none") return "";

  const out: string[] = [];
  let m: RegExpExecArray | null;
  FN_RE.lastIndex = 0;
  while ((m = FN_RE.exec(trimmed)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    const args = m[2] ?? "";
    if (TRANSLATE.has(name)) continue; // drop entirely
    if (name === "matrix") {
      const stripped = stripMatrix(args);
      if (stripped) out.push(stripped);
      continue;
    }
    if (name === "matrix3d") {
      const stripped = stripMatrix3d(args);
      if (stripped) out.push(stripped);
      continue;
    }
    if (KEEP.has(name)) {
      out.push(`${name}(${args})`);
      continue;
    }
    // Unknown function - drop conservatively. We'd rather lose a rare effect
    // than leak an unbounded translation.
  }
  return out.join(" ");
}

function stripMatrix(args: string): string {
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length !== 6) return "";
  const [a, b, c, d] = parts.map((p) => parseFloat(p));
  // Identity rotation/scale (a=d=1, b=c=0) plus any translation: the only
  // visual effect was the translation, which we just dropped → return empty.
  if (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Number.isFinite(c) &&
    Number.isFinite(d) &&
    Math.abs((a ?? 0) - 1) < 1e-6 &&
    Math.abs(b ?? 0) < 1e-6 &&
    Math.abs(c ?? 0) < 1e-6 &&
    Math.abs((d ?? 0) - 1) < 1e-6
  ) {
    return "";
  }
  return `matrix(${parts[0]}, ${parts[1]}, ${parts[2]}, ${parts[3]}, 0, 0)`;
}

function stripMatrix3d(args: string): string {
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length !== 16) return "";
  const m11 = parseFloat(parts[0] ?? "1");
  const m12 = parseFloat(parts[1] ?? "0");
  const m21 = parseFloat(parts[4] ?? "0");
  const m22 = parseFloat(parts[5] ?? "1");
  // m13 = 0-indexed 12 (tx), m14 = 13 (ty), m15 = 14 (tz). Zero out tx and ty;
  // keep tz so 3D perspective effects survive.
  const isIdentityRotScale =
    Math.abs(m11 - 1) < 1e-6 &&
    Math.abs(m12) < 1e-6 &&
    Math.abs(m21) < 1e-6 &&
    Math.abs(m22 - 1) < 1e-6 &&
    parseFloat(parts[14] ?? "0") === 0;
  if (isIdentityRotScale) return "";
  const out = [...parts];
  out[12] = "0";
  out[13] = "0";
  return `matrix3d(${out.join(", ")})`;
}
