import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  output: "standalone",
  // monorepo: trace workspace packages and the Prisma engine from the repository root
  outputFileTracingRoot: root,
  // the Prisma query engine is loaded by file path at runtime, so the bundler's tracer does not see it: include it explicitly
  outputFileTracingIncludes: { "/**/*": ["../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**"] },
  transpilePackages: ["@dienstplan/core", "@dienstplan/db"],
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};
export default config;
