import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTextSaver } from '@/context/TextSaverContext';
import { formatByteSize, isInbox, licenseStatusText } from '@/lib/app-utils';
import { BILLING_CONFIG, isCheckoutConfigured, isLicensingConfigured } from '@/lib/config.js';
import { serializedStateBytes } from '@/lib/plans.js';
import type { SaverTab, SyncSettings } from '@/types';
import {
  Check,
  Cloud,
  CloudOff,
  Crown,
  ExternalLink,
  HardDrive,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';

const compactButton = 'h-8 gap-1.5 px-2.5 text-[12px]';

function PanelHeader() {
  const { plan, actions } = useTextSaver();

  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <h1 id="plan-heading" className="text-base font-semibold">
          Plan &amp; cloud
        </h1>
        <span className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500">
          {plan.active.name}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Close plan and cloud"
        onClick={actions.closePlans}
      >
        <X />
      </Button>
    </header>
  );
}

function PlanStatusBar() {
  const { state, normalTabCount, plan } = useTextSaver();
  const storageUsed = state ? serializedStateBytes(state) : 0;

  return (
    <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border bg-muted/20 px-4 py-2">
      <p
        className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground"
        title={licenseStatusText(plan.license)}
      >
        <ShieldCheck className="size-3.5 shrink-0" />
        <span className="truncate">{licenseStatusText(plan.license)}</span>
      </p>
      <p className="whitespace-nowrap text-[11px] text-muted-foreground">
        {normalTabCount}/{plan.active.maxTabs} tabs · {formatByteSize(storageUsed)}/
        {formatByteSize(plan.active.maxStateBytes)}
      </p>
    </div>
  );
}

function ErrorBanner() {
  const { plan } = useTextSaver();
  if (!plan.licenseError) return null;

  return (
    <p
      className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-4 py-1.5 text-[11px] text-destructive"
      role="alert"
    >
      {plan.licenseError}
    </p>
  );
}

function SectionHeading({ icon, title, detail }: { icon: React.ReactNode; title: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-[13px] font-semibold">{title}</h2>
      </div>
      {detail && <span className="text-[10px] text-muted-foreground">{detail}</span>}
    </div>
  );
}

function ActivationSection() {
  const { plan, actions } = useTextSaver();
  const configured = isLicensingConfigured();

  return (
    <section className="shrink-0 rounded-lg border border-border bg-card p-3">
      <SectionHeading icon={<KeyRound className="size-4" />} title={plan.license ? 'License' : 'Activate Plus'} />
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {plan.license
          ? 'This installation is connected to your Plus license.'
          : 'Use the key from your receipt. One license supports two devices.'}
      </p>
      {!configured && !plan.license && (
        <p className="mt-2 text-[11px] text-destructive">Billing configuration is incomplete.</p>
      )}

      <div className="mt-2.5 grid grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] gap-2">
        <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
          License key
          <Input
            className="h-8 px-2.5 text-[12px]"
            type="password"
            autoComplete="off"
            maxLength={255}
            value={plan.licenseInput}
            placeholder={plan.license ? 'Enter a replacement key' : 'XXXXXX-XXXXXX-XXXXXX'}
            onChange={(event) => actions.setLicenseInput(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
          Device name
          <Input
            className="h-8 px-2.5 text-[12px]"
            autoComplete="off"
            maxLength={80}
            value={plan.deviceName}
            onChange={(event) => actions.setDeviceName(event.target.value)}
          />
        </label>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Button className={compactButton} disabled={plan.busy} onClick={actions.activateLicense}>
          {plan.busy ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
          {plan.license ? 'Replace key' : 'Activate'}
        </Button>
        {plan.license && (
          <>
            <Button className={compactButton} variant="outline" disabled={plan.busy} onClick={actions.validateLicense}>
              <RefreshCw /> Validate
            </Button>
            <Button
              className={compactButton}
              variant="destructive"
              disabled={plan.busy}
              onClick={actions.deactivateCurrent}
            >
              Disconnect
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function LicenseUsageSection() {
  const { plan } = useTextSaver();
  if (!plan.license) return null;
  const activeDevices = plan.license.activeDevices ?? 0;
  const maxDevices = plan.license.maxDevices ?? plan.active.maxDevices;
  const billing = plan.license.billingType === 'lifetime'
    ? 'Lifetime access'
    : plan.license.expiresAt
      ? `Renews or expires ${new Date(plan.license.expiresAt).toLocaleDateString()}`
      : 'Subscription';

  return (
    <section className="shrink-0 rounded-lg border border-border bg-card p-3">
      <SectionHeading
        icon={<HardDrive className="size-4" />}
        title="License usage"
        detail={`${activeDevices}/${maxDevices} devices`}
      />
      <div className="mt-2 rounded-md bg-muted/45 px-2.5 py-2">
        <p className="truncate text-[12px] font-medium">{plan.license.deviceName}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          This device · {billing}
        </p>
      </div>
    </section>
  );
}

function UpgradePanel() {
  const configured = isCheckoutConfigured();
  const features = [
    '20 local tabs',
    '20k characters per tab',
    '5 synced tabs across 2 devices',
    '5 MiB encrypted cloud storage',
  ];

  return (
    <section className="flex shrink-0 flex-col rounded-lg border border-amber-500/30 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-500">One-time upgrade</p>
          <h2 className="mt-1 text-lg font-semibold">Plus</h2>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold">$2.99</p>
          <p className="text-[10px] text-muted-foreground">lifetime</p>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        More room locally, plus end-to-end encrypted sync for the tabs you choose.
      </p>
      <ul className="mt-4 grid gap-2 text-[12px]">
        {features.map((feature) => (
          <li key={feature} className="flex items-center gap-2">
            <span className="grid size-4 place-items-center rounded-full bg-amber-500/10 text-amber-500">
              <Check className="size-3" />
            </span>
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-4">
        {configured ? (
          <Button asChild className="h-9 w-full text-[12px]">
            <a href={BILLING_CONFIG.plusCheckoutUrl} target="_blank" rel="noreferrer">
              Buy Plus <ExternalLink />
            </a>
          </Button>
        ) : (
          <Button className="h-9 w-full text-[12px]" disabled>
            <Crown /> Checkout coming soon
          </Button>
        )}
      </div>
    </section>
  );
}

function formatSyncStatus(settings: SyncSettings | null) {
  if (!settings?.enabled) return 'Not configured';
  if (settings.status === 'pending') {
    return settings.error || 'Changes are saved locally and waiting to sync';
  }
  if (settings.status === 'error' || settings.status === 'password-required') {
    return settings.error || 'Sync needs attention';
  }
  return settings.lastSyncedAt ? `Synced ${new Date(settings.lastSyncedAt).toLocaleString()}` : 'Ready to sync';
}

function SyncTabItem({ tab }: { tab: SaverTab }) {
  const { syncedTabIds, plan, actions } = useTextSaver();
  const selected = syncedTabIds.has(tab.id);
  const atLimit = syncedTabIds.size >= plan.active.maxSyncedTabs;

  return (
    <button
      type="button"
      className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
      disabled={plan.busy || (!selected && atLimit)}
      aria-pressed={selected}
      title={!selected && atLimit ? `You can sync up to ${plan.active.maxSyncedTabs} tabs.` : undefined}
      onClick={() => actions.toggleTabSync(tab.id)}
    >
      <span className="min-w-0 truncate text-[12px] font-medium">{tab.name}</span>
      <span
        className={`grid size-4 shrink-0 place-items-center rounded border ${selected ? 'border-amber-500 bg-amber-500 text-black' : 'border-muted-foreground/40'}`}
      >
        {selected && <Check className="size-3" />}
      </span>
    </button>
  );
}

function CloudSyncSection() {
  const { state, syncedTabIds, plan, actions } = useTextSaver();
  const tabs = state?.tabs.filter((tab) => !isInbox(tab)) ?? [];
  const enabled = Boolean(plan.syncSettings?.enabled);

  return (
    <section className="flex shrink-0 flex-col rounded-lg border border-border bg-card p-3">
      <SectionHeading
        icon={enabled ? <Cloud className="size-4 text-amber-500" /> : <CloudOff className="size-4" />}
        title="Cloud sync"
        detail={`${syncedTabIds.size}/${plan.active.maxSyncedTabs} tabs`}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">{formatSyncStatus(plan.syncSettings)}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Choose which tabs follow your license to another device. Content is encrypted before upload.
      </p>

      <div className="mt-2.5 flex flex-col">
        <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
          <span>Synced tabs</span>
          <span>{formatByteSize(plan.active.maxCloudBytes || 0)} max</span>
        </div>
        {tabs.length ? (
          <div className="grid max-h-40 min-h-9 grid-cols-2 content-start gap-1.5 overflow-y-auto pr-0.5">
            {tabs.map((tab) => (
              <SyncTabItem key={tab.id} tab={tab} />
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
            Add a tab to make it available for sync.
          </p>
        )}
      </div>

      <div className="mt-2.5 flex shrink-0 flex-wrap gap-1.5 border-t border-border pt-2.5">
        {!enabled ? (
          <Button className={compactButton} disabled={plan.busy} onClick={() => actions.setupSync()}>
            <Cloud /> Set up sync
          </Button>
        ) : (
          <>
            <Button className={compactButton} disabled={plan.busy} onClick={actions.syncNow}>
              {plan.busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Sync now
            </Button>
            <Button
              className={compactButton}
              variant="outline"
              disabled={plan.busy}
              onClick={() => actions.setupSync(true)}
            >
              Reset cloud
            </Button>
            <Button className={compactButton} variant="destructive" disabled={plan.busy} onClick={actions.turnOffSync}>
              Turn off
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

export function PlanPanel() {
  const { plan } = useTextSaver();
  if (!plan.open) return null;

  return (
    <section className="fixed inset-0 z-40 flex flex-col bg-background" aria-labelledby="plan-heading">
      <PanelHeader />
      <PlanStatusBar />
      <ErrorBanner />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
        <div className="flex shrink-0 flex-col gap-3">
          <ActivationSection />
          <LicenseUsageSection />
        </div>
        {plan.active.cloudSync ? <CloudSyncSection /> : <UpgradePanel />}
      </div>
    </section>
  );
}
