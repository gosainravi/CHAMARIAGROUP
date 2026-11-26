import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IT Infra Planner",
  description: "IT equipment layout, port matrix and BOQ planner",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
