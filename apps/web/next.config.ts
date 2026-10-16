import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@dienstplan/core", "@dienstplan/db"],
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};
export default config;
