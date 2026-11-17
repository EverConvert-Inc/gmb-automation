import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  canReplyFreeform,
  parseWebhookPayload,
  previewText,
  statusRank,
  verifyHandshake,
  verifyWhatsappSignature,
  type WhatsappWebhookPayload,
} from "./whatsapp-webhook";

const SECRET = "app-secret";
const sign = (body: string | Buffer) => "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");

describe("verifyWhatsappSignature", () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}';

  it("accepts Meta's sha256=<hex> header over the raw body", () => {
    expect(verifyWhatsappSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyWhatsappSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  it("hashes bytes as received: escaped unicode and its decoded form sign differently", () => {
    const escaped = '{"t":"caf\\u00e9"}';
    const decoded = '{"t":"café"}';
    expect(verifyWhatsappSignature(escaped, sign(escaped), SECRET)).toBe(true);
    expect(verifyWhatsappSignature(decoded, sign(escaped), SECRET)).toBe(false);
  });

  it("rejects a tampered body, wrong secret, missing header or missing secret", () => {
    expect(verifyWhatsappSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyWhatsappSignature(body, sign(body), "other")).toBe(false);
    expect(verifyWhatsappSignature(body, null, SECRET)).toBe(false);
    expect(verifyWhatsappSignature(body, sign(body), "")).toBe(false);
  });

  it("rejects a bare hex digest without the sha256= prefix", () => {
    expect(verifyWhatsappSignature(body, sign(body).slice(7), SECRET)).toBe(false);
  });
});

describe("verifyHandshake", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("echoes the challenge when mode and token match", () => {
    expect(verifyHandshake(q("hub.mode=subscribe&hub.verify_token=tok&hub.challenge=123"), "tok")).toBe("123");
  });
  it("refuses a wrong token, wrong mode, or an unset token", () => {
    expect(verifyHandshake(q("hub.mode=subscribe&hub.verify_token=no&hub.challenge=1"), "tok")).toBeNull();
    expect(verifyHandshake(q("hub.mode=other&hub.verify_token=tok&hub.challenge=1"), "tok")).toBeNull();
    expect(verifyHandshake(q("hub.mode=subscribe&hub.verify_token=&hub.challenge=1"), undefined)).toBeNull();
  });
});

function payload(value: object, field = "messages"): WhatsappWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA1", changes: [{ field, value: { metadata: { display_phone_number: "15551234567", phone_number_id: "PN1" }, ...value } }] }],
  };
}

describe("parseWebhookPayload", () => {
  it("reads a text message with BSUID, phone, profile and click-to-WhatsApp referral", () => {
    const { inbound, statuses } = parseWebhookPayload(
      payload({
        contacts: [{ profile: { name: "Ana" }, wa_id: "15550001111", user_id: "US.abc" }],
        messages: [
          {
            from: "15550001111",
            from_user_id: "US.abc",
            id: "wamid.1",
            timestamp: "1767225600",
            type: "text",
            text: { body: "Hi, I saw your ad" },
            referral: { source_id: "120000", source_type: "ad", headline: "Free consult", ctwa_clid: "clid" },
          },
        ],
      }),
    );
    expect(statuses).toEqual([]);
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({
      wabaId: "WABA1",
      phoneNumberId: "PN1",
      displayPhoneNumber: "15551234567",
      userId: "US.abc",
      waId: "15550001111",
      profileName: "Ana",
      wamid: "wamid.1",
      type: "text",
      body: "Hi, I saw your ad",
      referral: { source_id: "120000", ctwa_clid: "clid" },
    });
    expect(inbound[0].sentAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("keeps a username-only contact (no phone) keyed by BSUID", () => {
    const { inbound } = parseWebhookPayload(
      payload({
        contacts: [{ profile: { name: "Bo", username: "bo.law" }, user_id: "US.bo" }],
        messages: [{ from_user_id: "US.bo", id: "wamid.2", timestamp: "1767225600", type: "text", text: { body: "hey" } }],
      }),
    );
    expect(inbound[0]).toMatchObject({ userId: "US.bo", waId: null, username: "bo.law" });
  });

  it("matches each message to its own contact in a multi-contact change", () => {
    const { inbound } = parseWebhookPayload(
      payload({
        contacts: [
          { profile: { name: "A" }, wa_id: "1", user_id: "US.a" },
          { profile: { name: "B" }, wa_id: "2", user_id: "US.b" },
        ],
        messages: [
          { from: "2", id: "w.b", type: "text", text: { body: "b" } },
          { from_user_id: "US.a", id: "w.a", type: "text", text: { body: "a" } },
        ],
      }),
    );
    expect(inbound.map((m) => [m.wamid, m.profileName])).toEqual([["w.b", "B"], ["w.a", "A"]]);
  });

  it("describes media, location and reactions", () => {
    const { inbound } = parseWebhookPayload(
      payload({
        contacts: [{ wa_id: "1" }],
        messages: [
          { from: "1", id: "i", type: "image", image: { id: "M1", mime_type: "image/jpeg", caption: "my car" } },
          { from: "1", id: "d", type: "document", document: { id: "M2", mime_type: "application/pdf", filename: "police.pdf" } },
          { from: "1", id: "a", type: "audio", audio: { id: "M3", mime_type: "audio/ogg", voice: true } },
          { from: "1", id: "l", type: "location", location: { latitude: 1.5, longitude: 2.5, name: "Office" } },
          { from: "1", id: "r", type: "reaction", reaction: { message_id: "x", emoji: "👍" } },
        ],
      }),
    );
    const byId = Object.fromEntries(inbound.map((m) => [m.wamid, m]));
    expect(byId.i).toMatchObject({ mediaId: "M1", body: "my car", mediaMimeType: "image/jpeg" });
    expect(byId.d).toMatchObject({ mediaId: "M2", mediaFilename: "police.pdf", body: null });
    expect(byId.a).toMatchObject({ mediaId: "M3", body: null });
    expect(byId.l.body).toBe("Office (1.5, 2.5)");
    expect(byId.r.body).toBe("Reacted 👍");
  });

  it("reads statuses with Meta's error detail", () => {
    const { statuses } = parseWebhookPayload(
      payload({
        statuses: [
          { id: "wamid.out", status: "delivered", timestamp: "1767225600" },
          {
            id: "wamid.bad",
            status: "failed",
            timestamp: "1767225600",
            errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "More than 24 hours" } }],
          },
        ],
      }),
    );
    expect(statuses[0]).toMatchObject({ wamid: "wamid.out", status: "delivered", errorMessage: null });
    expect(statuses[1].errorMessage).toBe("131047 · Re-engagement message · More than 24 hours");
  });

  it("ignores other objects, other fields, and messages with no sender id", () => {
    expect(parseWebhookPayload({ object: "page", entry: [] }).inbound).toEqual([]);
    expect(parseWebhookPayload(payload({ messages: [{ from: "1", id: "x", type: "text" }] }, "account_update")).inbound).toEqual([]);
    expect(parseWebhookPayload(payload({ contacts: [], messages: [{ id: "x", type: "text" }] })).inbound).toEqual([]);
  });
});

describe("statusRank", () => {
  it("only lets status move forward", () => {
    expect(statusRank("sent")).toBeLessThan(statusRank("delivered"));
    expect(statusRank("delivered")).toBeLessThan(statusRank("read"));
    expect(statusRank("read")).toBeLessThan(statusRank("failed"));
    expect(statusRank("deleted")).toBe(-1);
  });
});

describe("canReplyFreeform", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  it("is open within 24h of the last inbound message and closed after", () => {
    expect(canReplyFreeform(new Date("2026-11-16T12:00:01Z"), now)).toBe(true);
    expect(canReplyFreeform(new Date("2026-11-16T12:00:00Z"), now)).toBe(false);
    expect(canReplyFreeform(null, now)).toBe(false);
  });
});

describe("previewText", () => {
  it("uses the text, or a label for media", () => {
    expect(previewText("text", "hello")).toBe("hello");
    expect(previewText("audio", null)).toBe("Voice message");
    expect(previewText("weird", null)).toBe("[weird]");
    expect(previewText("text", "x".repeat(200))).toHaveLength(140);
  });
});
