import { PageHeader } from "@/components/health/page-header";
import { SettingsClient } from "@/components/health/settings-client";
import { TopBar } from "@/components/health/top-bar";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar current="settings" />
      <PageHeader
        crumbs={["Dashboard", "Settings"]}
        title="Settings"
        subtitle="API key, data folder, updates."
      />
      <div className="px-8 pb-10">
        <SettingsClient />
      </div>
    </div>
  );
}
