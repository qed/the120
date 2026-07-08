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
  title: "The 120 — GT Toronto | Come join the network.",
  description:
    "A selective network of Toronto's 120 best and brightest students, grades 3–8. One year-long project, one subject mastered, and a city-wide tribe of true intellectual peers. 3–5 hours a week. Only 120 seats.",
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
