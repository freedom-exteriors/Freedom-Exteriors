import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pdfkit reads its font files from node_modules at run time, so it must not
  // be bundled, and those files must ship with the PDF routes.
  serverExternalPackages: ["sharp", "pdfkit"],
  outputFileTracingIncludes: {
    "/api/invoices/[id]/pdf": ["./node_modules/pdfkit/js/data/**"],
    "/api/estimates/[id]/pdf": ["./node_modules/pdfkit/js/data/**"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
