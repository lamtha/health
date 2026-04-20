import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/health/page-header";
import { TopBar } from "@/components/health/top-bar";

export const dynamic = "force-static";

const SUPPORTED_FORMATS = [
  {
    group: "Blood panels",
    providers: "Quest, LabCorp, Lifeforce, Function Health, Boston Heart",
    note: "CBC, CMP, lipids, thyroid, hormones, nutrients, inflammation.",
  },
  {
    group: "GI / microbiome",
    providers:
      "Diagnostic Solutions GI-MAP, Doctor's Data GI-360, Vibrant Gut Zoomer, Viome, Great Plains OAT, Mosaic, MARCoNS",
    note: "Commensal / opportunistic organisms, parasites, SCFAs, digestion + barrier markers.",
  },
  {
    group: "Imaging & other narrative",
    providers: "(Phase 8)",
    note: "Imaging reports and clinical notes are extracted as summaries rather than metrics.",
  },
];

export default function WelcomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="welcome" />
      <PageHeader
        crumbs={["Welcome"]}
        title="Welcome to Health"
        subtitle="Local-first lab dashboard. Your data stays on this machine."
      />

      <div className="space-y-4 px-8 pb-10">
        <Card>
          <CardHeader>
            <CardTitle className="text-[13px]">What this app does</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[13px]">
            <p>
              Drop lab PDFs onto <Link href="/uploads" className="underline">the Upload page</Link>.
              Each PDF is sent to Anthropic&apos;s Claude API, which extracts provider,
              date, and a structured list of metrics with units + reference ranges.
              Results land in a local SQLite database on your machine — no cloud
              sync, no account required.
            </p>
            <p>
              Metrics are unified across providers via a canonical taxonomy, so
              &quot;WBC&quot; / &quot;White Blood Cell Count&quot; / &quot;Leukocytes&quot;
              chart as one line. Click any metric from the dashboard to see its trend
              across every provider, with reference-range bands and your logged
              interventions overlaid.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[13px]">What stays local</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[13px]">
            <p>
              <span className="font-medium">Everything except the extraction request.</span>{" "}
              Your SQLite database, your uploaded PDFs, your notes, and your rolling
              logs all live in
              <code className="mx-1 font-mono text-[12px]">~/Library/Application Support/Health/</code>
              on this machine.
            </p>
            <p>
              The only network egress is the Claude API call at the moment you
              upload a PDF: your API key + the PDF bytes go to
              <code className="mx-1 font-mono text-[12px]">api.anthropic.com</code>
              and the structured extraction comes back. No telemetry, no analytics,
              no background sync.
            </p>
            <p>
              Your Anthropic API key is encrypted with macOS{" "}
              <code className="font-mono text-[12px]">safeStorage</code> (Keychain-backed) and
              never leaves the machine except as the auth header on the extraction call.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[13px]">Supported report formats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            {SUPPORTED_FORMATS.map((f) => (
              <div
                key={f.group}
                className="border-b border-border px-5 py-3 last:border-b-0"
              >
                <div className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
                  {f.group}
                </div>
                <div className="mt-0.5 text-[13px]">{f.providers}</div>
                <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {f.note}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[13px]">Get started</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/uploads">Upload a PDF</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/settings">Settings</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/">Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
