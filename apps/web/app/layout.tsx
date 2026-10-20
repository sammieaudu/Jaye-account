import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";
import "./jaye-theme.css";
export const metadata: Metadata = {
  title: "Jaye Finance · Your money, accounted for",
  description: "GoJaye’s local spend and accounting workspace.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {process.env.JAYE_MODE === "hosted" ? (
          <ClerkProvider>{children}</ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
