export function generateNextConfig(): string {
  return `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Suppress the dev-mode "N" build-activity indicator. It only appears
  // in \`next dev\` (not in production), but the QA loop captures from
  // the dev server, so the indicator pollutes the pixel diff against
  // the source. Disabling here means the comparison reflects what
  // ships in production.
  devIndicators: false,
};

export default nextConfig;
`;
}

export function generatePostcssConfig(): string {
  return `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
}
