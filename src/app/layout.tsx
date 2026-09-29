import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TopNav } from "@/components/consoles/TopNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bharat BaaS",
  description: "Pay-per-km EV battery billing as a biller category on Bharat Connect (prototype).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col overflow-x-hidden">
        <TopNav />
        {children}
        <footer className="mt-auto border-t border-black/10 px-4 py-2 text-center text-xs text-neutral-600">
          Hackathon prototype. Not affiliated with or endorsed by Maruti Suzuki, Bajaj Finance, NPCI or NBBL.
          All data is fictional and no real payments are made.
        </footer>
      </body>
    </html>
  );
}
