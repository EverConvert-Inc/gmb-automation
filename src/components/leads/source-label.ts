/** Admin-only: how each lead source is labelled. The portal never shows a source. */
export const SOURCE_LABEL: Record<string, string> = { call: "Call", form: "Form", text: "Text" };

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}
