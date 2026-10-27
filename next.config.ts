import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { webpackMemoryOptimizations: true, cpus: 1 },
  serverExternalPackages: ["mongodb", "redis", "argon2", "sharp", "pdfkit", "nodemailer"],
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./artifacts/**/*", "./.env*"],
  },
  async headers() {
    return [{source:"/:path*",headers:[
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"X-Frame-Options",value:"DENY"},
      {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
      {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(self)"},
      {key:"X-DNS-Prefetch-Control",value:"off"},
      {key:"X-Permitted-Cross-Domain-Policies",value:"none"},
      {key:"Cross-Origin-Opener-Policy",value:"same-origin-allow-popups"},
      ...(process.env.APP_URL?.startsWith("https://") ? [{key:"Strict-Transport-Security",value:"max-age=31536000"}] : []),
    ]}];
  },
};

export default nextConfig;
