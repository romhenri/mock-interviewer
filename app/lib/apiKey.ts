"use client";

const KEY = "openrouter-api-key";

/** localStorage (not sessionStorage): a pasted key should survive closing the tab. */
export function loadApiKey(): string | null {
  return localStorage.getItem(KEY);
}

export function saveApiKey(key: string): void {
  localStorage.setItem(KEY, key.trim());
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY);
}
