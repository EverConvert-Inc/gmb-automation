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
