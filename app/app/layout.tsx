import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/** The interviewer's face. Kept as a text file so the art stays editable as art. */
const agent = readFileSync(join(process.cwd(), "agent.txt"), "utf8");

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Interviewer",
  description: "Practice interview questions, scored on correctness, English and depth.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="flex justify-center pt-8">
          <pre
            aria-label="The interviewer"
            className="select-none font-mono text-[9px] leading-[1.05] opacity-80"
          >
            {agent}
          </pre>
        </header>
        {children}
      </body>
    </html>
  );
}
