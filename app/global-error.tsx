"use client";

import { useEffect } from "react";

import { ErrorScreen } from "@/components/health/error-screen";

import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <ErrorScreen error={error} onContinue={reset} />
      </body>
    </html>
  );
}
