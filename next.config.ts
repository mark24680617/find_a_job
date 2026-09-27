import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs cannot find its worker chunk when bundled into a route handler (docs/notes/deps.md,
  // "`getTextContent()` inside a Next route handler"), so it is loaded from node_modules.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
