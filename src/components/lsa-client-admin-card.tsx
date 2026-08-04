"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, RefreshCw, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComboBox } from "@/components/ui/combobox";
import { Input, Label } from "@/components/ui/form";
import { CallrailWebhookSecretField } from "@/components/callrail-webhook-secret-field";

type ExistingAdsCredential = {
  id: string;
  accountEmail: string;
  updatedAt: Date;
};
type DiscoveredAdsCustomer = { id: string; name: string | null };
type CallrailCompanyOption = { id: string; name: string };

export type LsaClientAdminProps = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  googleAdsTokenSaved: boolean;
  googleAdsLinked: boolean;
  googleAdsCustomerId: string | null;
  googleAdsDiscoveredCustomers: DiscoveredAdsCustomer[] | null;
  loginCustomerId: string | null;
  callrailLinked: boolean;
  callrailCompanyId: string | null;
  signedCaseTag: string;
  signedCaseNameFilters: string[];
  gmbCallrailNameFilters: string[];
  lastAdsSyncAt: Date | null;
  lastCallrailSyncAt: Date | null;
  lastSyncError: string | null;
  callrailCompanyChoices: CallrailCompanyOption[] | null;
  callrailListError: string | null;
  webhookSecretConfigured: boolean;
  webhookSecretUpdatedAt: string | null;
  existingAdsCredentials: ExistingAdsCredential[];
  linkedAdsCustomerMap: Record<string, string[]>;
  linkedCallrailCompanyMap: Record<string, string[]>;
};

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

export function LsaClientAdminCard(props: LsaClientAdminProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [refreshingCustomers, setRefreshingCustomers] = useState(false);

  const [customerDraft, setCustomerDraft] = useState(
    props.googleAdsCustomerId ?? "",
  );
  const [loginCustomerDraft, setLoginCustomerDraft] = useState(
    props.loginCustomerId ?? "",
  );
  const [loginCustomerDirty, setLoginCustomerDirty] = useState(false);
  const [tagDraft, setTagDraft] = useState(props.signedCaseTag);
  const [nameFiltersDraft, setNameFiltersDraft] = useState(
    props.signedCaseNameFilters.join(", "),
  );
  const [tagFiltersDirty, setTagFiltersDirty] = useState(false);
  // Independent of signedCaseTag/signedCaseNameFilters above — this only
  // feeds the Ads Conversion Tracker x CallRail report's LSA/GMB channel
  // split (and only when this client's CallRail company has no matching
  // PPC record — see lsa-sync.ts), not the signed-case count.
  const [gmbFiltersDraft, setGmbFiltersDraft] = useState(
    props.gmbCallrailNameFilters.join(", "),
  );
  const [gmbFiltersDirty, setGmbFiltersDirty] = useState(false);
  const [companyDraft, setCompanyDraft] = useState(props.callrailCompanyId ?? "");

  async function saveField(body: Record<string, unknown>, successMsg: string) {
    const res = await fetch(`/api/lsa/clients/${props.id}`, {
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

  // Auto-save the customer id when the user picks one, then — if this is
  // the first time Ads + a CallRail company are linked — fire off the
  // initial sync without an explicit click, same as PPC's admin card.
  async function handleAdsCustomerPick(rawId: string) {
    const cleaned = rawId.replace(/-/g, "").trim();
    setCustomerDraft(rawId);
    try {
      await saveField(
        { googleAdsCustomerId: cleaned || null },
        !props.lastAdsSyncAt
          ? "Account linked — running first sync now."
          : "Account linked — Sync now to pull the latest data.",
      );
      if (!props.lastAdsSyncAt && cleaned) {
        void runSync();
      }
    } catch (err) {
      toast.error("Couldn't link account", {
        description: (err as Error).message,
      });
    }
  }

  async function refreshAdsCustomers() {
    setRefreshingCustomers(true);
    try {
      const res = await fetch(
        `/api/lsa/clients/${props.id}/refresh-customers`,
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

  async function handleCallrailCompanyPick(rawId: string) {
    setCompanyDraft(rawId);
    try {
      await saveField(
        { callrailCompanyId: rawId || null },
        !props.lastCallrailSyncAt
          ? "CallRail company linked — running first sync now."
          : "CallRail company linked — Sync now to pull the latest data.",
      );
      if (!props.lastCallrailSyncAt && rawId) {
        void runSync();
      }
    } catch (err) {
      toast.error("Couldn't link company", {
        description: (err as Error).message,
      });
    }
  }

  async function attachExisting(credentialId: string) {
    setAttachingId(credentialId);
    try {
      const res = await fetch(`/api/lsa/clients/${props.id}/attach-ads`, {
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
          description: `Using ${detail.accountEmail}. Set the login-customer-id below, then Sync now.`,
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
          description: detail.errorMessage ?? "See below for details.",
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

  // syncLsaForClient() handles both sources internally, so the response
  // shape here is flatter than PPC's — a top-level `error` only appears
  // when BOTH sources failed (syncLsaForClient throws); adsError/
  // callrailError cover a single-source failure while the sync still
  // succeeds overall.
  async function runSync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/lsa/clients/${props.id}/sync-now`, {
        method: "POST",
      });
      const out = (await res.json().catch(() => ({}))) as {
        daysWritten?: number;
        adsError?: string | null;
        callrailError?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(out.error ?? `HTTP ${res.status}`);
      }
      const parts = [
        `${out.daysWritten ?? 0} day${out.daysWritten === 1 ? "" : "s"} written`,
      ];
      if (out.adsError) parts.push(`Google Ads: ${out.adsError}`);
      if (out.callrailError) parts.push(`CallRail: ${out.callrailError}`);
      if (out.adsError || out.callrailError) {
        toast.warning("Sync completed with errors", { description: parts.join(" · ") });
      } else {
        toast.success("Sync complete", { description: parts.join(" · ") });
      }
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
        `Delete "${props.name}"? All Google Ads and CallRail history for this LSA client will be removed.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/lsa/clients/${props.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success(`${props.name} deleted`);
    router.push("/lsa/clients");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Local Services · LSA client
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
                {props.lastAdsSyncAt
                  ? `Last synced ${relTime(props.lastAdsSyncAt)}`
                  : "Awaiting first sync."}
              </div>
            </div>
          ) : props.googleAdsTokenSaved ? (
            <p className="text-muted-foreground">
              Pick the Google Ads account for this client below. If the
              expected account isn&apos;t in the dropdown, hit{" "}
              <strong>Refresh list</strong> after granting access in Google
              Ads, or paste the 10-digit customer id manually.
            </p>
          ) : props.existingAdsCredentials.length > 0 ? (
            <div className="space-y-3">
              <p className="text-muted-foreground">
                Reuse a Google account you&apos;ve already connected (e.g. for
                a PPC client). There&apos;s no separate LSA login — pick the
                customer id for this client below once attached.
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
            </div>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              No Google Ads OAuth credential is saved yet. LSA reuses an
              existing connection rather than a separate login — connect one
              via a PPC client first (Settings &rsaquo; PPC clients), then it
              will show up here to reuse.
            </div>
          )}

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
                  <ComboBox
                    id="customerId"
                    options={props.googleAdsDiscoveredCustomers.map((c) => {
                      const linked = props.linkedAdsCustomerMap[c.id];
                      return {
                        id: c.id,
                        name: c.name,
                        meta:
                          linked && linked.length > 0
                            ? `Already linked to: ${linked.join(", ")}`
                            : null,
                      };
                    })}
                    value={customerDraft}
                    onChange={handleAdsCustomerPick}
                    placeholder="— Select an account —"
                    prefilterText={props.name}
                    formatId={formatCustomerId}
                    disabled={pending || syncing}
                  />
                  <p className="text-xs text-muted-foreground">
                    {props.googleAdsDiscoveredCustomers.length} account
                    {props.googleAdsDiscoveredCustomers.length === 1 ? "" : "s"}
                    {" "}visible. Pre-filtered to <em>{props.name}</em> —
                    clear the search box to see them all. Selection saves
                    automatically.
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
                      onClick={() => handleAdsCustomerPick(customerDraft)}
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

          {/* login_customer_id: unlike PPC (one global
              GOOGLE_ADS_LOGIN_CUSTOMER_ID env var for every account), each
              LSA client can sit under a different MCC, so this is a plain
              manual field rather than a combobox — there's no discovery
              endpoint for "which manager account reaches this customer". */}
          {props.googleAdsTokenSaved && (
            <div>
              <Label htmlFor="loginCustomerId">Login customer ID (MCC)</Label>
              <div className="flex gap-2">
                <Input
                  id="loginCustomerId"
                  value={loginCustomerDraft}
                  onChange={(e) => {
                    setLoginCustomerDraft(e.target.value);
                    setLoginCustomerDirty(true);
                  }}
                  placeholder="663-311-7348"
                  pattern="[0-9-]*"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const cleaned = loginCustomerDraft.replace(/-/g, "").trim();
                    saveField(
                      { loginCustomerId: cleaned || null },
                      "Login customer ID saved",
                    )
                      .then(() => setLoginCustomerDirty(false))
                      .catch((e) => toast.error((e as Error).message));
                  }}
                  disabled={pending || !loginCustomerDirty}
                >
                  {loginCustomerDirty ? "Save" : "Saved"}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                The manager account (MCC) this client&apos;s Google Ads
                customer sits under. Required when the customer isn&apos;t
                directly reachable with the connected account alone — Google
                Ads returns an authorization error naming this exact
                requirement if it&apos;s missing or wrong.
              </p>
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

          <div>
            <Label htmlFor="callrailCompany">CallRail company</Label>
            {props.callrailCompanyChoices ? (
              <ComboBox
                id="callrailCompany"
                options={props.callrailCompanyChoices.map((c) => {
                  const linked = props.linkedCallrailCompanyMap[c.id];
                  return {
                    id: c.id,
                    name: c.name,
                    meta:
                      linked && linked.length > 0
                        ? `Already linked to: ${linked.join(", ")}`
                        : null,
                  };
                })}
                value={companyDraft}
                onChange={handleCallrailCompanyPick}
                placeholder="— Select a company —"
                prefilterText={props.name}
                disabled={pending || syncing}
              />
            ) : (
              <div className="flex gap-2">
                <Input
                  id="callrailCompany"
                  value={companyDraft}
                  onChange={(e) => setCompanyDraft(e.target.value)}
                  placeholder="CallRail company id"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleCallrailCompanyPick(companyDraft)}
                  disabled={pending}
                >
                  Save
                </Button>
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Pre-filtered to <em>{props.name}</em>. Selection saves
              automatically.
            </p>
          </div>

          <CallrailWebhookSecretField
            companyId={props.callrailCompanyId}
            configured={props.webhookSecretConfigured}
            updatedAt={props.webhookSecretUpdatedAt}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="signedTag">Signed-case tag</Label>
              <Input
                id="signedTag"
                value={tagDraft}
                onChange={(e) => {
                  setTagDraft(e.target.value);
                  setTagFiltersDirty(true);
                }}
                placeholder="Signed"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Calls tagged with this name count as signed cases.
              </p>
            </div>
            <div>
              <Label htmlFor="nameFilters">
                Tracking-number name filters
              </Label>
              <Input
                id="nameFilters"
                value={nameFiltersDraft}
                onChange={(e) => {
                  setNameFiltersDraft(e.target.value);
                  setTagFiltersDirty(true);
                }}
                placeholder="LSA"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Comma-separated substrings. A signed call only counts if its
                tracking number&apos;s name contains one of these
                (case-insensitive). Leave blank to count every tagged call
                regardless of which number it came in on.
              </p>
            </div>
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
                    signedCaseTag: tagDraft || "Signed",
                    signedCaseNameFilters: filters,
                  },
                  "Tag & filters saved",
                )
                  .then(() => setTagFiltersDirty(false))
                  .catch((e) => toast.error((e as Error).message));
              }}
              disabled={pending || !tagFiltersDirty}
            >
              {tagFiltersDirty ? "Save tag & filters" : "Saved"}
            </Button>
            {tagFiltersDirty && (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Unsaved changes
              </span>
            )}
            {props.callrailLinked && (
              <span className="text-xs text-muted-foreground">
                {props.lastCallrailSyncAt
                  ? `Last synced ${relTime(props.lastCallrailSyncAt)}`
                  : "Awaiting first sync."}
              </span>
            )}
          </div>
          <div>
            <Label htmlFor="gmbNameFilters">
              GMB tracker name filters (Call Quality report)
            </Label>
            <Input
              id="gmbNameFilters"
              value={gmbFiltersDraft}
              onChange={(e) => {
                setGmbFiltersDraft(e.target.value);
                setGmbFiltersDirty(true);
              }}
              placeholder="GMB"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Comma-separated substrings. In the Ads Conversion Tracker x
              CallRail report, a call whose tracking number&apos;s name
              contains one of these (case-insensitive) is classified as
              channel &ldquo;GMB&rdquo;; every other call on this client is
              classified as &ldquo;LSA&rdquo;. Only takes effect when this
              client&apos;s CallRail company has no matching PPC
              client — otherwise GMB classification stays owned by that PPC
              client to avoid double-counting the same calls under both.
              Independent of the signed-case tag/filters above — leave blank
              to classify every call as LSA.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const filters = gmbFiltersDraft
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                saveField(
                  { gmbCallrailNameFilters: filters },
                  "GMB filters saved",
                )
                  .then(() => setGmbFiltersDirty(false))
                  .catch((e) => toast.error((e as Error).message));
              }}
              disabled={pending || !gmbFiltersDirty}
            >
              {gmbFiltersDirty ? "Save GMB filters" : "Saved"}
            </Button>
            {gmbFiltersDirty && (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Unsaved changes
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
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete LSA client
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Removes the client record and its daily leads/cost/signed-case
            rollups. The OAuth credential row is kept in case another client
            reuses it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
