"use client";

import { loadApiKey } from "./apiKey.ts";
import { FREE_MODELS } from "./models.ts";

const KEY = "mock-interview-settings";

/** Where a new interview's questions come from. Values are stored, labels are shown. */
export const SOURCES = {
  generate: "Complete generation",
  mixed: "Mixed with cache",
  cache: "Only cache",
} as const;

export type Source = keyof typeof SOURCES;

export type Settings = {
  /** null means no preference: the server's own chain order decides. */
  model: string | null;
  source: Source;
};

/** Mixed is the default because it is what the app did before Settings existed. */
export const DEFAULT_SETTINGS: Settings = { model: null, source: "mixed" };

/** localStorage (not sessionStorage): a preference should outlive the tab. */
export function loadSettings(): Settings {
  return parse(localStorage.getItem(KEY));
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

/** What both API routes read: the user's own key and their model preference. */
export function openRouterHeaders(): Record<string, string> {
  const apiKey = loadApiKey();
  const { model } = loadSettings();
  return {
    ...(apiKey ? { "x-openrouter-key": apiKey } : {}),
    ...(model ? { "x-openrouter-model": model } : {}),
  };
}

/**
 * localStorage is user-editable and the model name is sent on to OpenRouter, so
 * an unrecognised one falls back to no preference rather than being forwarded.
 * Pure, so it can be tested without storage.
 */
export function parse(raw: string | null): Settings {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "");
  } catch {
    return DEFAULT_SETTINGS;
  }

  const candidate = (value ?? {}) as Partial<Settings>;
  return {
    model: FREE_MODELS.includes(candidate.model as (typeof FREE_MODELS)[number])
      ? candidate.model!
      : null,
    source: candidate.source! in SOURCES ? candidate.source! : DEFAULT_SETTINGS.source,
  };
}
