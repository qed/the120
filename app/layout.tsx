import type { Metadata } from "next";
import {
  Space_Grotesk,
  IBM_Plex_Mono,
  Fraunces,
  Inter,
  Spline_Sans_Mono,
} from "next/font/google";
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

// The Path fonts (T1 Unit 13, plan Decision 3). `preload: false` is the whole
// point: these are declared on the root layout so /path never triggers a full
// page reload from a route-group split, but marketing pages — which use none of
// the font-path-* utilities — declare the @font-face without ever FETCHING the
// files. All three are variable fonts, so no `weight` is specified.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const splineSansMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "The 120 — Toronto's most motivated and engaged kids",
  description:
    "A selective network of 120 kids across five groups: the Athletes, the Founders, the Makers, the Scholars, and the Givers. Ages 8–17, 3–5 hours a week, alongside any school. Only 120 seats.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} ${fraunces.variable} ${inter.variable} ${splineSansMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <AccountModalProvider>{children}</AccountModalProvider>
      </body>
    </html>
  );
}
