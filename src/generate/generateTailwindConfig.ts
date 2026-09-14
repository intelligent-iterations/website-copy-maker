import type { DesignTokens } from "../analyze/inferTokens.js";

export function generateTailwindConfig(tokens: DesignTokens): string {
  const radii = tailwindRadii(tokens.radii);
  const shadows = tailwindShadows(tokens.shadows);

  return `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./data/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        page: ${JSON.stringify(tokens.colors.page)},
        ink: ${JSON.stringify(tokens.colors.ink)},
        muted: ${JSON.stringify(tokens.colors.muted)},
        accent: ${JSON.stringify(tokens.colors.accent)},
      },
      borderRadius: ${JSON.stringify(radii, null, 8).replace(/\n/g, "\n      ")},
      boxShadow: ${JSON.stringify(shadows, null, 8).replace(/\n/g, "\n      ")},
      maxWidth: {
        page: ${JSON.stringify(tokens.maxContentWidth + "px")},
      },
    },
  },
  plugins: [],
};

export default config;
`;
}

function tailwindRadii(radii: readonly string[]): Record<string, string> {
  if (radii.length === 0) return { card: "16px", panel: "24px" };
  const out: Record<string, string> = {};
  radii.slice(0, 5).forEach((r, i) => {
    const key = i === 0 ? "card" : i === 1 ? "panel" : `r${i}`;
    out[key] = r;
  });
  return out;
}

function tailwindShadows(shadows: readonly string[]): Record<string, string> {
  if (shadows.length === 0) return { soft: "0 24px 80px rgba(0,0,0,0.12)" };
  const out: Record<string, string> = {};
  shadows.slice(0, 3).forEach((s, i) => {
    const key = i === 0 ? "soft" : `s${i}`;
    out[key] = s;
  });
  return out;
}
