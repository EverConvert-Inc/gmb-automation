"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, RefreshCw, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form";

type CallrailCompanyOption = { id: string; name: string };
type ExistingAdsCredential = {
  id: string;
  accountEmail: string;
  updatedAt: Date;
};
type DiscoveredAdsCustomer = { id: string; name: string | null };

export type PpcClientAdminProps = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  googleAdsTokenSaved: boolean;
  googleAdsLinked: boolean;
  googleAdsCustomerId: string | null;
  googleAdsDiscoveredCustomers: DiscoveredAdsCustomer[] | null;
  callrailLinked: boolean;
  callrailCompanyId: string | null;
  signedCaseTag: string;
  signedCaseNameFilters: string[];
  lastAdsSyncAt: Date | null;
  lastCallrailSyncAt: Date | null;
  lastSyncError: string | null;
  callrailCompanyChoices: CallrailCompanyOption[] | null;
  callrailListError: string | null;
  existingAdsCredentials: ExistingAdsCredential[];
};

// Format a 10-digit customer id as "123-456-7890" for readability.
function formatCustomerId(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function relTime(d: Date | string | null): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function PpcClientAdminCard(props: PpcClientAdminProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [refreshingCustomers, setRefreshingCustomers] = useState(false);

  async function refreshAdsCustomers() {
    setRefreshingCustomers(true);
    try {
      const res = await fetch(
        `/api/ppc/clients/${props.id}/refresh-customers`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        count?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Found ${body.count ?? 0} Google Ads account(s)`);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("Refresh failed", { description: (err as Error).message });
    } finally {
      setRefreshingCustomers(false);
    }
  }
  const [tagDraft, setTagDraft] = useState(props.signedCaseTag);
  const [nameFiltersDraft, setNameFiltersDraft] = useState(
    props.signedCaseNameFilters.join(", "),
  );
  const [companyDraft, setCompanyDraft] = useState(props.callrailCompanyId ?? "");
  const [customerDraft, setCustomerDraft] = useState(
    props.googleAdsCustomerId ?? "",
  );

  async function attachExisting(credentialId: string) {
    setAttachingId(credentialId);
    try {
      const res = await fetch(`/api/ppc/clients/${props.id}/attach-ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oauthCredentialId: credentialId }),
      });
      const detail = (await res.json().catch(() => ({}))) as {
        status?: string;
        customerId?: string;
        accountEmail?: string;
        errorMessage?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(detail.error ?? `HTTP ${res.status}`);
      }
      if (detail.status === "linked") {
        toast.success(`Linked to customer ${detail.customerId}`, {
          description: `Using ${detail.accountEmail}. Run Sync now to backfill.`,
        });
      } else if (detail.status === "needs_picker") {
        toast.success("Connection attached", {
          description: `${detail.accountEmail} manages multiple customer ids — paste the right one below.`,
        });
      } else if (detail.status === "no_customers") {
        toast.warning("Attached but no Ads accounts visible", {
          description: `${detail.accountEmail} doesn't have access to any Google Ads customers.`,
        });
      } else if (detail.status === "list_failed") {
        toast.warning("Attached, but couldn't list accounts", {
          description: detail.errorMessage ?? "See the page banner for details.",
        });
      }
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("Couldn't attach connection", {
        description: (err as Error).message,
      });
    } finally {
      setAttachingId(null);
    }
  }

  async function saveField(body: Record<string, unknown>, successMsg: string) {
    const res = await fetch(`/api/ppc/clients/${props.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(detail.error ?? `HTTP ${res.status}`);
    }
    toast.success(successMsg);
    startTransition(() => router.refresh());
  }

  async function runSync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/ppc/clients/${props.id}/sync-now`, {
        method: "POST",
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(detail.error ?? `HTTP ${res.status}`);
      }
      const out = (await res.json()) as {
        googleAds: { ok: boolean; error?: string; daysIngested?: number };
        callrail: { ok: boolean; error?: string; daysIngested?: number };
      };
      const parts = [
        `Google Ads: ${out.googleAds.ok ? `${out.googleAds.daysIngested ?? 0} rows` : (out.googleAds.error ?? "skipped")}`,
        `CallRail: ${out.callrail.ok ? `${out.callrail.daysIngested ?? 0} days` : (out.callrail.error ?? "skipped")}`,
      ];
      toast.success("Sync complete", { description: parts.join(" · ") });
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("Sync failed", {
        description: (err as Error).message,
      });
    } finally {
      setSyncing(false);
    }
  }

  async function deleteClient() {
    if (
      !confirm(
        `Delete "${props.name}"? All Google Ads and CallRail history for this PPC client will be removed.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/ppc/clients/${props.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success(`${props.name} deleted`);
    router.push("/ppc/clients");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Paid Search · PPC client
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {props.name}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Slug: <code>{props.slug}</code>
            {!props.isActive && (
              <Badge variant="secondary" className="ml-2">
                Paused
              </Badge>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              saveField(
                { isActive: !props.isActive },
                props.isActive ? "Paused" : "Reactivated",
              ).catch((e) => toast.error((e as Error).message))
            }
            disabled={pending}
          >
            {props.isActive ? "Pause" : "Reactivate"}
          </Button>
          <Button onClick={runSync} disabled={syncing} size="sm">
            <RefreshCw
              className={`mr-2 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </div>

      {props.lastSyncError && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <div className="font-medium">Last sync error</div>
            <div className="text-xs">{props.lastSyncError}</div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google Ads</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {props.googleAdsLinked ? (
            <div className="space-y-2">
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Customer ID
                </span>
                <div className="mt-0.5 font-mono">{props.googleAdsCustomerId}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                Last synced {relTime(props.lastAdsSyncAt)}
              </div>
              <a
                href={`/api/oauth/google-ads/start?ppcClientId=${props.id}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                &rsaquo; Connect a different Google account
              </a>
            </div>
          ) : props.googleAdsTokenSaved ? (
            <div className="space-y-3">
              <p className="text-muted-foreground">
                Pick the Google Ads account for this client below. If the
                expected account isn&apos;t in the dropdown, hit{" "}
                <strong>Refresh list</strong> after granting access in Google
                Ads, or paste the 10-digit customer id manually.
              </p>
              <a
                href={`/api/oauth/google-ads/start?ppcClientId=${props.id}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                &rsaquo; Connect a different Google account
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {props.existingAdsCredentials.length > 0 ? (
                <>
                  <p className="text-muted-foreground">
                    Reuse a Google account you&apos;ve already connected.
                    You&apos;ll only need to pick the customer id for this
                    client &mdash; no OAuth round-trip.
                  </p>
                  <div className="space-y-2">
                    {props.existingAdsCredentials.map((c) => {
                      const isAttaching = attachingId === c.id;
                      const disabled = attachingId !== null;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => attachExisting(c.id)}
                          disabled={disabled}
                          className="group flex w-full items-center justify-between gap-3 rounded-md border bg-background p-3 text-left transition-colors hover:border-brand/50 hover:bg-brand/5 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand ring-1 ring-brand/20">
                              <UserRound className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {c.accountEmail}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Connected {relTime(c.updatedAt)}
                              </div>
                            </div>
                          </div>
                          <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground shadow-sm group-hover:brightness-110">
                            {isAttaching ? (
                              "Linking…"
                            ) : (
                              <>
                                Use this account
                                <ArrowRight className="h-3.5 w-3.5" />
                              </>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground">
                      Or connect a different Google account
                    </summary>
                    <a
                      href={`/api/oauth/google-ads/start?ppcClientId=${props.id}`}
                      className={`mt-2 inline-block ${buttonClasses("outline", "sm")}`}
                    >
                      Connect a different Google account
                    </a>
                  </details>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    Authorize the agency Google account that has access to this
                    client&apos;s Google Ads. We&apos;ll pull campaigns, clicks,
                    conversions, phone calls, cost and impressions daily.
                  </p>
                  <a
                    href={`/api/oauth/google-ads/start?ppcClientId=${props.id}`}
                    className={buttonClasses()}
                  >
                    Connect Google Ads
                  </a>
                </>
              )}
            </div>
          )}

          {/* Customer-id picker. Renders a dropdown sourced from the
              cached discovery (listAccessibleCustomers + descriptive_name)
              when available, with a refresh button. Falls back to a
              free-text input when no discovery data is on file. */}
          {props.googleAdsTokenSaved && (
            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="customerId">Google Ads account</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={refreshAdsCustomers}
                  disabled={refreshingCustomers || pending}
                >
                  <RefreshCw
                    className={`mr-1.5 h-3 w-3 ${refreshingCustomers ? "animate-spin" : ""}`}
                  />
                  {refreshingCustomers ? "Refreshing…" : "Refresh list"}
                </Button>
              </div>
              {props.googleAdsDiscoveredCustomers &&
              props.googleAdsDiscoveredCustomers.length > 0 ? (
                <>
                  <div className="flex gap-2">
                    <Select
                      id="customerId"
                      value={customerDraft}
                      onChange={(e) => setCustomerDraft(e.target.value)}
                    >
                      <option value="">— Select an account —</option>
                      {props.googleAdsDiscoveredCustomers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name
                            ? `${c.name} (${formatCustomerId(c.id)})`
                            : formatCustomerId(c.id)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        saveField(
                          { googleAdsCustomerId: customerDraft || null },
                          "Customer id saved",
                        ).catch((e) => toast.error((e as Error).message))
                      }
                      disabled={pending || !customerDraft}
                    >
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {props.googleAdsDiscoveredCustomers.length} account
                    {props.googleAdsDiscoveredCustomers.length === 1 ? "" : "s"}
                    {" "}visible to the connected Google user. If you don&apos;t
                    see the right one, hit Refresh after granting access in
                    Google Ads.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      id="customerId"
                      value={customerDraft}
                      onChange={(e) => setCustomerDraft(e.target.value)}
                      placeholder="123-456-7890"
                      pattern="[0-9-]+"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        saveField(
                          { googleAdsCustomerId: customerDraft || null },
                          "Customer id saved",
                        ).catch((e) => toast.error((e as Error).message))
                      }
                      disabled={pending}
                    >
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    No account list cached yet &mdash; click <strong>Refresh
                    list</strong> above to discover the Google Ads accounts
                    visible to the connected user, or paste the 10-digit
                    customer id manually.
                  </p>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CallRail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {props.callrailListError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <strong>Couldn&apos;t load companies:</strong>{" "}
              {props.callrailListError}. Set CALLRAIL_API_KEY (and optionally
              CALLRAIL_ACCOUNT_ID) on the deployment, or enter a company id
              manually below.
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="callrailCompany">CallRail company</Label>
              {props.callrailCompanyChoices ? (
                <Select
                  id="callrailCompany"
                  value={companyDraft}
                  onChange={(e) => setCompanyDraft(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {props.callrailCompanyChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="callrailCompany"
                  value={companyDraft}
                  onChange={(e) => setCompanyDraft(e.target.value)}
                  placeholder="CallRail company id"
                />
              )}
            </div>
            <div>
              <Label htmlFor="signedTag">Signed-case tag</Label>
              <Input
                id="signedTag"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                placeholder="Signed"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Calls tagged with this name count as signed cases.
              </p>
            </div>
          </div>
          <div>
            <Label htmlFor="nameFilters">
              Tracking-number name filters
            </Label>
            <Input
              id="nameFilters"
              value={nameFiltersDraft}
              onChange={(e) => setNameFiltersDraft(e.target.value)}
              placeholder="PPC, Ads, GMB"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Comma-separated substrings. A signed call only counts if its
              tracking number&apos;s name contains one of these (case-
              insensitive). Leave blank to count every tagged call regardless
              of which number it came in on.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const filters = nameFiltersDraft
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                saveField(
                  {
                    callrailCompanyId: companyDraft || null,
                    signedCaseTag: tagDraft || "Signed",
                    signedCaseNameFilters: filters,
                  },
                  "CallRail settings saved",
                ).catch((e) => toast.error((e as Error).message));
              }}
              disabled={pending}
            >
              Save CallRail settings
            </Button>
            {props.callrailLinked && (
              <span className="text-xs text-muted-foreground">
                Last synced {relTime(props.lastCallrailSyncAt)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-red-700 dark:text-red-400">
            Danger zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" size="sm" onClick={deleteClient}>
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete PPC client
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Removes the client record, its campaigns, daily Google Ads rows,
            and CallRail rollups. The OAuth credential row is kept in case
            another client reuses it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
