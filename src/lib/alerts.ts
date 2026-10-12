export async function postSlackAlert(payload: {
  locationName: string;
  rating: number;
  reviewerName: string | null;
  text: string | null;
  reviewCreatedAt: string;
  // The business's public Google Maps listing, when we have one on file —
  // not a link to the review itself. GBP's v4 reviews API exposes no
  // per-review URL, same limitation as postTakedownAlert.
  mapsUrl: string | null;
}): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const stars = "★".repeat(payload.rating) + "☆".repeat(5 - payload.rating);
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Low-rated review on ${payload.locationName}*\n${stars} (${payload.rating}/5)`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${payload.reviewerName ?? "Anonymous"}*\n${payload.text ?? "_(no text)_"}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Posted ${new Date(payload.reviewCreatedAt).toISOString().slice(0, 10)}`,
        },
      ],
    },
    ...(payload.mapsUrl
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `<${payload.mapsUrl}|Open ${payload.locationName} on Google Maps>`,
            },
          },
        ]
      : []),
  ];

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
}

// Fired once per location, the poll where consecutivePollFailures first
// reaches POLL_FAILURE_ALERT_THRESHOLD (see LocationPollError in reviews.ts).
// Backoff/retry keeps running regardless — this is purely a "someone should
// look at this" notification, not part of the retry logic itself.
export async function postPollFailureAlert(payload: {
  locationName: string;
  clientName: string;
  consecutiveFailures: number;
  lastPollError: string;
}): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *Review sync failing — ${payload.clientName} / ${payload.locationName}*\n${payload.consecutiveFailures} consecutive failed polls. Reviews for this location have stopped updating until this is resolved.`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Last error: \`${payload.lastPollError}\``,
        },
      ],
    },
  ];

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
}

// Fired once per review, the first time it's confirmed gone from a GBP full
// sweep for TAKEDOWN_CONFIRM_MINUTES straight (see detectAndConfirmTakedowns
// in reviews.ts). By the time this fires the review is already gone from
// the GBP UI too, so this payload — plus the /takedowns dashboard page — is
// the only remaining record of it for filing Google's reinstatement request.
export async function postTakedownAlert(payload: {
  locationName: string;
  clientName: string;
  rating: number;
  reviewerName: string | null;
  text: string | null;
  reviewCreatedAt: Date;
  lastSeenAt: Date;
  // The business's public Google Maps listing, when we have one on file —
  // not a link to the review itself. Google's review API exposes no
  // per-review URL, so there's nothing more specific to link to.
  mapsUrl: string | null;
}): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const stars = "★".repeat(payload.rating) + "☆".repeat(5 - payload.rating);
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:rotating_light: *Review takedown detected — ${payload.clientName} / ${payload.locationName}*\nThis review has vanished from Google Business Profile and is no longer visible in the GBP UI. File a reinstatement request with the details below.`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${payload.reviewerName ?? "Anonymous"}* — ${stars} (${payload.rating}/5)\n${payload.text ?? "_(no text)_"}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Originally posted ${payload.reviewCreatedAt.toISOString().slice(0, 10)} · Last confirmed live ${payload.lastSeenAt.toISOString().slice(0, 10)}`,
        },
      ],
    },
    ...(payload.mapsUrl
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `<${payload.mapsUrl}|Open ${payload.locationName} on Google Maps>`,
            },
          },
        ]
      : []),
  ];

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
}

// Fired when CallRail delivers a "Call Modified" event for a company that
// has no webhook secret on file (see callrailWebhookSecrets in schema.ts).
// The receiver answers 200 rather than 404 in that case specifically so
// CallRail does not auto-disable the subscription — see the comment at the
// not-configured branch in the call-modified route for why. That 200 makes
// the failure silent on CallRail's side, so this alert is what makes it
// loud on ours.
//
// Deliberately un-throttled: a company should only ever be in this state
// between "webhook created in CallRail" and "secret pasted into the admin
// card," so the volume is a symptom, not noise. If this ever does become
// noisy, the fix is to paste the secret, not to quieten the alert.
export async function postCallrailWebhookUnconfiguredAlert(payload: {
  callrailCompanyId: string;
  callrailCallId: string;
}): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return;
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:warning: *CallRail webhook secret missing*\nA "Call Modified" event arrived for CallRail company \`${payload.callrailCompanyId}\`, but no webhook secret is configured for it. The event was acknowledged and discarded — real-time signed-case tracking is not running for this company.`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Open the client's admin card and paste the secret from CallRail's webhook settings (Advanced Settings on the webhook config) to start recording these events.",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Call ${payload.callrailCallId}`,
        },
      ],
    },
  ];

  // Bounded, unlike the other helpers here: this one is awaited inside the
  // call-modified webhook's 15s maxDuration, and a hung Slack request would
  // push that route into a timeout — i.e. the exact non-2xx that would get
  // the subscription auto-disabled again. The caller catches the abort.
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
    signal: AbortSignal.timeout(5_000),
  });
}
