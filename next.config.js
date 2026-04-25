/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfjs-dist is ESM-first and breaks under webpack bundling
  // ("Object.defineProperty called on non-object"); load it from
  // node_modules at runtime instead.
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist"],
};

module.exports = nextConfig;
