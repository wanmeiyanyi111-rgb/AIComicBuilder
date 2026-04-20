import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config, { dev }) => {
    if (dev) {
      const rawIgnored = config.watchOptions?.ignored;
      const currentIgnored = Array.isArray(rawIgnored)
        ? rawIgnored.filter(
            (item): item is string => typeof item === "string" && item.length > 0
          )
        : typeof rawIgnored === "string" && rawIgnored.length > 0
          ? [rawIgnored]
          : [];
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...currentIgnored,
          "**/data/**",
          "**/uploads/**",
          "**/.next/**",
        ],
      };
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
