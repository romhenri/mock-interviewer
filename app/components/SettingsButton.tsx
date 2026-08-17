"use client";

import { useRef, useState } from "react";
import { FREE_MODELS, modelLabel } from "@/lib/models";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SOURCES,
  type Settings,
  type Source,
} from "@/lib/settings";

/** Header button plus its dialog. Settings are read back from storage where they
 *  are used, so nothing here needs to be shared with the page. */
export default function SettingsButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  /** Read on open, not on mount: localStorage is not there during the server render. */
  function open() {
    setSettings(loadSettings());
    dialog.current?.showModal();
  }

  return (
    <>
      <button
        onClick={open}
        className="rounded-lg border border-current/20 px-3 py-1.5 text-sm transition hover:border-current/50"
      >
        Settings
      </button>

      <dialog
        ref={dialog}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-current/20 bg-background p-6 text-foreground backdrop:bg-black/50"
      >
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-lg font-medium">Settings</h2>
            <p className="mt-1 text-sm opacity-60">
              Stored in this browser, applied to the next interview.
            </p>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="opacity-60">Priority model</span>
            <select
              value={settings.model ?? ""}
              onChange={(event) =>
                setSettings({ ...settings, model: event.target.value || null })
              }
              className="rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm"
            >
              <option value="">Fastest available (default)</option>
              {FREE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {modelLabel(model)}
                </option>
              ))}
            </select>
            <span className="text-xs opacity-50">
              Tried first. The others still cover for it when the free pool rate-limits.
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="opacity-60">Questions source</span>
            <select
              value={settings.source}
              onChange={(event) =>
                setSettings({ ...settings, source: event.target.value as Source })
              }
              className="rounded-lg border border-current/20 bg-transparent px-3 py-2 text-sm"
            >
              {Object.entries(SOURCES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="text-xs opacity-50">
              Every generated question is cached. Only cache reuses those; ground truth uses a
              fixed hand-written set. Neither spends a request.
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={() => dialog.current?.close()}
              className="mr-auto rounded-lg px-3 py-2 text-sm opacity-60 transition hover:opacity-100"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                saveSettings(settings);
                dialog.current?.close();
              }}
              className="rounded-lg border border-current/30 px-5 py-2 text-sm font-medium transition hover:border-current/60"
            >
              Save
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
