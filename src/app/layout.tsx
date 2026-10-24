import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SBOM Sentinel",
  description: "Software supply-chain intelligence for application teams.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
