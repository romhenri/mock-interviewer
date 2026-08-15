/**
 * Free models that support strict structured output, ordered by measured
 * response time on the shared free pool (Aug 2026): gemma ~5s, nemotron-super
 * ~17s, gpt-oss ~18s, nemotron-nano ~37s. The fallback chain is tried in this
 * order, so the fastest survivor answers first.
 *
 * Shared rather than server-only because Settings offers the same list, and a
 * dropdown listing a model the chain does not know is a dead option.
 */
export const FREE_MODELS = [
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-20b:free",
  "nvidia/nemotron-nano-9b-v2:free",
] as const;

/** "google/gemma-4-26b-a4b-it:free" reads as "gemma-4-26b-a4b-it" in the dropdown. */
export function modelLabel(id: string): string {
  return id.split("/").at(-1)!.replace(":free", "");
}
