import { Cloud, Crown, ExternalLink, HardDrive, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BILLING_CONFIG, isBillingConfigured } from '@/lib/config.js';
import type { Device, License, SyncSettings } from '@/types';

type Plan = {
  id: string;
  name: string;
  maxTabs: number;
  maxStateBytes: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  usage: string;
  license: License | null;
  licenseStatus: string;
  licenseKey: string;
  setLicenseKey: (value: string) => void;
  deviceName: string;
  setDeviceName: (value: string) => void;
  devices: Device[];
  deviceError: string;
  error: string;
  busy: boolean;
  syncSettings: SyncSettings | null;
  onActivate: () => void;
  onValidate: () => void;
  onDeactivateCurrent: () => void;
  onRefreshDevices: () => void;
  onDeactivateDevice: (device: Device) => void;
  onSetupSync: (reset?: boolean) => void;
  onSyncNow: () => void;
  onDisableSync: () => void;
};

function PurchaseCard() {
  const configured = isBillingConfigured();
  return (
    <article className="relative overflow-hidden rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-card p-4">
      <Crown className="absolute right-4 top-4 size-5 text-amber-500" />
      <div className="flex items-baseline gap-2">
        <h3 className="font-semibold">Plus</h3>
        <span className="text-[11px] text-muted-foreground">$2.99 lifetime</span>
      </div>
      <p className="mb-4 mt-2 min-h-9 text-[12px] leading-relaxed text-muted-foreground">
        20 tabs, 20k characters and 10k lines per tab, plus 5 MiB encrypted cloud sync.
      </p>
      {configured ? (
        <Button asChild size="sm"><a href={BILLING_CONFIG.plusCheckoutUrl} target="_blank" rel="noreferrer">Buy Plus <ExternalLink /></a></Button>
      ) : (
        <Button size="sm" disabled>Checkout coming soon</Button>
      )}
    </article>
  );
}

export function PlanPanel(props: Props) {
  if (!props.open) return null;
  const syncStatus = props.syncSettings?.enabled
    ? props.syncSettings.status === 'error' || props.syncSettings.status === 'password-required'
      ? props.syncSettings.error || 'Sync needs attention'
      : `Last synced ${props.syncSettings.lastSyncedAt ? new Date(props.syncSettings.lastSyncedAt).toLocaleString() : 'never'}`
    : 'Not configured';

  return (
    <section className="fixed inset-0 z-40 flex flex-col bg-background" aria-labelledby="plan-heading">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h1 id="plan-heading" className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-amber-500" />Plan &amp; cloud</h1>
          <p className="mt-1 text-[12px] text-muted-foreground">Manage your license, devices, and end-to-end encrypted sync.</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close plan and cloud" onClick={props.onClose}><X /></Button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <section className="rounded-xl border border-border bg-card p-4 shadow-glow">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-500">{props.plan.name}</span>
              <strong className="text-sm">{props.plan.name} plan</strong>
            </div>
            <span className="text-[12px] text-muted-foreground">{props.usage}</span>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground"><ShieldCheck className="size-4" />{props.licenseStatus}</p>
        </section>

        <div className="mx-auto w-full max-w-md"><PurchaseCard /></div>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" /><h2 className="text-sm font-semibold">Activate a license</h2></div>
          <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">Paste the license key from your Creem receipt. Each paid key supports two installations.</p>
          {!isBillingConfigured() && <p className="mb-3 text-[13px] text-destructive">Billing configuration is incomplete.</p>}
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <label className="grid gap-1.5 text-[12px] text-muted-foreground">License key
              <Input type="password" autoComplete="off" maxLength={120} value={props.licenseKey} placeholder={props.license ? 'License active — key not stored' : 'XXXXXX-XXXXXX-XXXXXX'} onChange={(event) => props.setLicenseKey(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-[12px] text-muted-foreground">Device name
              <Input autoComplete="off" maxLength={80} value={props.deviceName} onChange={(event) => props.setDeviceName(event.target.value)} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={props.busy} onClick={props.onActivate}>{props.busy ? <LoaderCircle className="animate-spin" /> : <KeyRound />}Activate</Button>
            {props.license && <Button size="sm" variant="outline" disabled={props.busy} onClick={props.onValidate}><RefreshCw />Validate now</Button>}
            {props.license && <Button size="sm" variant="destructive" disabled={props.busy} onClick={props.onDeactivateCurrent}>Deactivate this device</Button>}
          </div>
          {props.error && <p className="mt-3 text-[13px] text-destructive" role="alert">{props.error}</p>}
        </section>

        {props.license && (
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><HardDrive className="size-4 text-muted-foreground" /><h2 className="text-sm font-semibold">Activated devices</h2></div>
              <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onRefreshDevices}><RefreshCw />Refresh</Button>
            </div>
            <div className="mt-3 space-y-1.5">
              {props.deviceError && <p className="text-[13px] text-destructive">{props.deviceError}</p>}
              {!props.deviceError && !props.devices.length && <p className="text-[13px] text-muted-foreground">No recorded installations.</p>}
              {props.devices.map((device) => (
                <div key={device.installationId} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
                  <div className="min-w-0 truncate text-[13px]">{device.deviceName}{device.installationId === props.license?.installationId && <span className="text-[11px] text-muted-foreground"> (this device)</span>}</div>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={props.busy} onClick={() => props.onDeactivateDevice(device)}><Trash2 />Deactivate</Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {props.plan.id === 'plus' && (
          <section className="rounded-xl border border-amber-500/30 bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2"><Cloud className="size-4 text-amber-500" /><h2 className="text-sm font-semibold">Encrypted cloud sync</h2></div>
                <p className="mt-1 text-[12px] text-muted-foreground">{syncStatus}</p>
              </div>
              <span className="text-[11px] text-muted-foreground">5 MiB maximum</span>
            </div>
            <p className="my-3 text-[12px] leading-relaxed text-muted-foreground">Your sync password encrypts notes before upload. It cannot be recovered.</p>
            <div className="flex flex-wrap gap-2">
              {!props.syncSettings?.enabled ? (
                <Button size="sm" onClick={() => props.onSetupSync()} disabled={props.busy}><Cloud />Set up sync</Button>
              ) : (
                <>
                  <Button size="sm" onClick={props.onSyncNow} disabled={props.busy}><RefreshCw />Sync now</Button>
                  <Button size="sm" variant="outline" onClick={() => props.onSetupSync(true)} disabled={props.busy}>Reset cloud copy</Button>
                  <Button size="sm" variant="destructive" onClick={props.onDisableSync} disabled={props.busy}>Turn off sync</Button>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
