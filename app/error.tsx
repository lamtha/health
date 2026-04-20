"use client";

import { useEffect } from "react";

import { ErrorScreen } from "@/components/health/error-screen";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <ErrorScreen error={error} onContinue={reset} />;
}
