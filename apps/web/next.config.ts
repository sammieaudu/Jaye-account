import type { NextConfig } from "next";
if (process.env.VERCEL === "1") {
  const required = [
    "JAYE_API_URL",
    "JAYE_API_SECRET",
    "JAYE_OWNER_EMAIL",
    "JAYE_APP_ORIGIN",
    "CLERK_SECRET_KEY",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  ];
  if (
    process.env.JAYE_MODE !== "hosted" ||
    required.some((name) => !process.env[name])
  )
    throw new Error(
      "Vercel deployment requires hosted mode and complete backend/sign-in configuration. See docs/DEPLOYMENT.md.",
    );
}
const config: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
