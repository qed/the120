import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import AccountModalProvider from "@/app/components/account/AccountModalProvider";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "The 120 — Toronto's most motivated and engaged kids",
  description:
    "A selective network of 120 kids across five groups: the Athletes, the Founders, the Makers, the Scholars, and the Givers. Grades 3–8, 3–5 hours a week, alongside any school. Only 120 seats.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <AccountModalProvider>{children}</AccountModalProvider>
      </body>
    </html>
  );
}
