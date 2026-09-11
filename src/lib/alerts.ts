export async function postSlackAlert(payload: {
  locationName: string;
  rating: number;
  reviewerName: string | null;
  text: string | null;
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
  ];

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });
}
