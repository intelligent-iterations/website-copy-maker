import type { ProjectModel } from "./createProject.js";

export function generateLayout(model: ProjectModel): string {
  const title = JSON.stringify(model.metadata.title ?? model.siteName);
  const description = JSON.stringify(model.metadata.description ?? "");

  return `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: ${title},
  description: ${description},
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
`;
}
