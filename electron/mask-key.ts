// Pure helper. Masks an API key for display. Kept separate so both the
// Electron main process (which decrypts the key from Keychain) and any
// future web-side display can share one implementation.

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 10) return "•".repeat(Math.max(trimmed.length, 6));
  const prefix = trimmed.startsWith("sk-ant-") ? "sk-ant-" : trimmed.slice(0, 4);
  const last4 = trimmed.slice(-4);
  return `${prefix}…${last4}`;
}
