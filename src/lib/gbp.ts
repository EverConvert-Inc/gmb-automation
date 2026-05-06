import { decryptString } from "./crypto";

export type GbpReview = {
  reviewId: string;
  rating: number;
  text: string | null;
  reviewerName: string | null;
  reviewerPhotoUrl: string | null;
  createdAt: string;
  updatedAt: string;
  reply?: { text: string; updatedAt: string } | null;
};

const STAR_RATING_MAP: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export async function getAccessToken(refreshTokenEncrypted: string): Promise<string> {
  const refreshToken = decryptString(refreshTokenEncrypted);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export type GbpAccount = { name: string; accountName?: string; type?: string; role?: string };
export type GbpLocation = {
  name: string;
  title?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string };
  metadata?: { placeId?: string };
};

export async function listAccounts(accessToken: string): Promise<GbpAccount[]> {
  const out: GbpAccount[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`GBP listAccounts failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { accounts?: GbpAccount[]; nextPageToken?: string };
    if (json.accounts) out.push(...json.accounts);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

export async function listLocations(
  accessToken: string,
  accountResourceName: string,
): Promise<GbpLocation[]> {
  const out: GbpLocation[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountResourceName}/locations`,
    );
    url.searchParams.set("readMask", "name,title,storefrontAddress,metadata");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`GBP listLocations failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { locations?: GbpLocation[]; nextPageToken?: string };
    if (json.locations) out.push(...json.locations);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

export async function fetchReviews({
  accountId,
  locationId,
  refreshTokenEncrypted,
  updatedSince,
}: {
  accountId: string;
  locationId: string;
  refreshTokenEncrypted: string;
  updatedSince?: Date;
}): Promise<GbpReview[]> {
  const token = await getAccessToken(refreshTokenEncrypted);
  const out: GbpReview[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`,
    );
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`GBP reviews fetch failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      reviews?: Array<{
        reviewId: string;
        starRating: string;
        comment?: string;
        reviewer?: { displayName?: string; profilePhotoUrl?: string };
        createTime: string;
        updateTime: string;
        reviewReply?: { comment?: string; updateTime?: string };
      }>;
      nextPageToken?: string;
    };

    for (const r of json.reviews ?? []) {
      if (updatedSince && new Date(r.updateTime) <= updatedSince) {
        return out;
      }
      out.push({
        reviewId: r.reviewId,
        rating: STAR_RATING_MAP[r.starRating] ?? 0,
        text: r.comment ?? null,
        reviewerName: r.reviewer?.displayName ?? null,
        reviewerPhotoUrl: r.reviewer?.profilePhotoUrl ?? null,
        createdAt: r.createTime,
        updatedAt: r.updateTime,
        reply: r.reviewReply
          ? { text: r.reviewReply.comment ?? "", updatedAt: r.reviewReply.updateTime ?? "" }
          : null,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  return out;
}
