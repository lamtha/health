"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface UpdateResult {
  status: "not-implemented" | "up-to-date" | "available";
  message: string;
}

interface HealthBridge {
  isElectron: true;
  getMaskedKey: () => Promise<string | null>;
  replaceApiKey: (key: string) => Promise<{ ok: true }>;
  revealUserData: () => Promise<string>;
  revealLogs: () => Promise<string>;
  getUserDataPath: () => Promise<string>;
  getLogsPath: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateResult>;
}

function getBridge(): HealthBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { health?: HealthBridge }).health;
  return bridge?.isElectron ? bridge : null;
}

export function SettingsClient() {
  const [bridge, setBridge] = useState<HealthBridge | null>(null);
  const [maskedKey, setMaskedKey] = useState<string | null | undefined>(
    undefined,
  );
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [logsPath, setLogsPath] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);

  useEffect(() => {
    const b = getBridge();
    setBridge(b);
    if (b) {
      void b.getMaskedKey().then(setMaskedKey);
      void b.getUserDataPath().then(setDataDir);
      void b.getLogsPath().then(setLogsPath);
    } else {
      setMaskedKey(null);
    }
  }, []);

  const refreshMasked = useCallback(async () => {
    if (!bridge) return;
    setMaskedKey(await bridge.getMaskedKey());
  }, [bridge]);

  return (
    <div className="space-y-4">
      {!bridge && <DevModeNotice />}

      <ApiKeyCard
        bridge={bridge}
        maskedKey={maskedKey}
        onReplaceClick={() => setReplaceOpen(true)}
      />
      <DataFolderCard bridge={bridge} dataDir={dataDir} />
      <LogsCard bridge={bridge} logsPath={logsPath} />
      <UpdatesCard bridge={bridge} />
      <AboutCard />

      <ReplaceKeyDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        bridge={bridge}
        onSaved={() => {
          setReplaceOpen(false);
          void refreshMasked();
        }}
      />
    </div>
  );
}

function DevModeNotice() {
  return (
    <Card>
      <CardContent className="text-[13px] text-muted-foreground">
        Running in web-dev mode — Electron-only actions (API key, Reveal folder,
        Check for updates) are disabled. Launch via{" "}
        <code className="font-mono text-[12px]">pnpm app:dev</code> to use them.
      </CardContent>
    </Card>
  );
}

function ApiKeyCard({
  bridge,
  maskedKey,
  onReplaceClick,
}: {
  bridge: HealthBridge | null;
  maskedKey: string | null | undefined;
  onReplaceClick: () => void;
}) {
  const keyLabel =
    maskedKey === undefined
      ? "Loading…"
      : maskedKey === null
        ? "No key saved"
        : maskedKey;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13px]">Anthropic API key</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[13px]">{keyLabel}</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            stored in your macOS Keychain, encrypted with
            <code className="mx-1 font-mono text-[10px]">safeStorage</code>.
          </div>
        </div>
        <Button
          variant="outline"
          disabled={!bridge}
          onClick={onReplaceClick}
        >
          Replace…
        </Button>
      </CardContent>
    </Card>
  );
}

function DataFolderCard({
  bridge,
  dataDir,
}: {
  bridge: HealthBridge | null;
  dataDir: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13px]">Data folder</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px]">
            {dataDir ?? (bridge ? "Loading…" : "(only available in the packaged app)")}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            health.db, uploaded PDFs, and rolling logs live here.
          </div>
        </div>
        <Button
          variant="outline"
          disabled={!bridge}
          onClick={() => void bridge?.revealUserData()}
        >
          Reveal in Finder
        </Button>
      </CardContent>
    </Card>
  );
}

function LogsCard({
  bridge,
  logsPath,
}: {
  bridge: HealthBridge | null;
  logsPath: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13px]">Logs</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px]">
            {logsPath ?? (bridge ? "Loading…" : "(only available in the packaged app)")}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            rolling daily files, kept 14 days.
          </div>
        </div>
        <Button
          variant="outline"
          disabled={!bridge}
          onClick={() => void bridge?.revealLogs()}
        >
          Open log folder
        </Button>
      </CardContent>
    </Card>
  );
}

function UpdatesCard({ bridge }: { bridge: HealthBridge | null }) {
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    if (!bridge) return;
    setChecking(true);
    try {
      setResult(await bridge.checkForUpdates());
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13px]">Updates</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px]">
            {result?.message ?? "Click to check the release feed."}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            auto-update lands in Phase 7.
          </div>
        </div>
        <Button
          variant="outline"
          disabled={!bridge || checking}
          onClick={() => void check()}
        >
          {checking ? "Checking…" : "Check for updates"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AboutCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[13px]">About</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-[12px] text-muted-foreground">
        <div>
          Health — local-first personal health dashboard. Data stays on this
          machine; the Claude API is the only network egress.
        </div>
        <div className="font-mono text-[10.5px]">
          bundle id <code>com.lamthalabs.health</code>
        </div>
      </CardContent>
    </Card>
  );
}

function ReplaceKeyDialog({
  open,
  onOpenChange,
  bridge,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bridge: HealthBridge | null;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setKey("");
      setError(null);
      setSaving(false);
    }
  }, [open]);

  const submit = async () => {
    if (!bridge) return;
    setError(null);
    const trimmed = key.trim();
    if (!trimmed) {
      setError("Key is required.");
      return;
    }
    if (!/^sk-ant-/.test(trimmed)) {
      setError("That doesn't look like an Anthropic key (should start with sk-ant-).");
      return;
    }
    setSaving(true);
    try {
      await bridge.replaceApiKey(trimmed);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace API key</DialogTitle>
          <DialogDescription>
            Validates the new key against Anthropic before saving. The old key
            is overwritten in your macOS Keychain.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            type="password"
            placeholder="sk-ant-..."
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          {error && (
            <div className="text-[12px] text-destructive">{error}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "Validating…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
