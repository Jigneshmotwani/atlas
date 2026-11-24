import type { NextConfig } from "next";

// cacheComponents is off on purpose (see NOTES.md): pages use plain
// request-time Server Components with `export const revalidate`.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
