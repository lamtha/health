"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatErrorDetails, type ErrorLike } from "@/lib/error-details";

interface ErrorScreenProps {
  error: ErrorLike;
  onContinue: () => void;
}

export function ErrorScreen({ error, onContinue }: ErrorScreenProps) {
  const [copied, setCopied] = useState(false);

  const details = formatErrorDetails(error);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard.writeText can reject in insecure contexts; fall back silently.
    }
  };

  const quit = () => {
    window.close();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {error.message || "An unexpected error occurred."}
          </p>
          <details className="rounded-md border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer select-none font-medium">
              Details
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
              {details}
            </pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copy}>
              {copied ? "Copied!" : "Copy details"}
            </Button>
            <Button onClick={onContinue}>Continue</Button>
            <Button variant="destructive" onClick={quit}>
              Quit
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
