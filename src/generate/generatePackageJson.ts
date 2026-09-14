import type { ProjectModel } from "./createProject.js";

export function generatePackageJson(model: ProjectModel): string {
  const pkg = {
    name: slugify(model.siteName),
    version: "0.1.0",
    private: true,
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start",
      lint: "next lint",
    },
    dependencies: {
      next: "^15.0.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
    },
    devDependencies: {
      "@types/node": "^22.0.0",
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      autoprefixer: "^10.4.0",
      postcss: "^8.4.0",
      tailwindcss: "^3.4.0",
      typescript: "^5.6.0",
    },
  };
  return JSON.stringify(pkg, null, 2) + "\n";
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "rebuilt-site"
  );
}
