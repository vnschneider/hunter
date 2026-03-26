import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mantem uma unica fonte de env no monorepo (arquivo .env da raiz).
dotenv.config({ path: path.join(__dirname, "../..", ".env") });

/** @type {import("next").NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  transpilePackages: ["@hunter/db"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "avatars.googleusercontent.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
