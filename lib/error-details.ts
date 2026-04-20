// Pure formatter for crash/error details. Used by the React error boundaries
// (app/error.tsx, app/global-error.tsx) to build the string that the "Copy
// details" button writes to the clipboard, and shaped so a user who pastes
// the result into an issue has everything needed to triage.

export interface ErrorLike {
  name?: string;
  message?: string;
  stack?: string;
  digest?: string;
}

export function formatErrorDetails(
  error: ErrorLike,
  now: Date = new Date(),
): string {
  const lines: string[] = [
    `Time: ${now.toISOString()}`,
    `Message: ${error.message || "(no message)"}`,
  ];
  if (error.name && error.name !== "Error") {
    lines.push(`Name: ${error.name}`);
  }
  if (error.digest) {
    lines.push(`Digest: ${error.digest}`);
  }
  lines.push("", "Stack:", error.stack ?? "(no stack)");
  return lines.join("\n");
}
