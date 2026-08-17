"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SettingsButton from "./SettingsButton";

/** The art rides along on every screen; the two entry points only belong on home. */
export default function SiteHeader({ agent }: { agent: string }) {
  const home = usePathname() === "/";

  return (
    <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-6 pt-8">
      {home && (
        <Link
          href="/cache"
          className="rounded-lg border border-current/20 px-3 py-1.5 text-sm transition hover:border-current/50"
        >
          Cache
        </Link>
      )}
      {/* mx-auto keeps the art centred whether or not the buttons are there. */}
      <pre
        aria-label="The interviewer"
        className="mx-auto select-none font-mono text-[9px] leading-[1.05] opacity-80"
      >
        {agent}
      </pre>
      {home && <SettingsButton />}
    </header>
  );
}
