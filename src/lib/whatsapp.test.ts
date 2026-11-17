import { describe, expect, it, vi } from "vitest";
import { GRAPH_API_VERSION, listWabas, registerPhoneNumber, sendText, WhatsappApiError } from "./whatsapp";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("sendText", () => {
  it("POSTs a text message to the pinned Graph version and returns the wamid", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ messaging_product: "whatsapp", contacts: [{ input: "1555", wa_id: "1555" }], messages: [{ id: "wamid.X" }] }),
    );
    const res = await sendText("PN1", "1555", "hello", { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ wamid: "wamid.X", waId: "1555" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}/PN1/messages`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "1555",
      type: "text",
      text: { body: "hello", preview_url: false },
    });
  });

  it("surfaces Graph's error message and code (e.g. the closed 24h window)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Re-engagement message", code: 131047 } }, 400),
    );
    const err = await sendText("PN1", "1", "x", { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(WhatsappApiError);
    expect(err).toMatchObject({ message: "Re-engagement message", code: 131047, status: 400 });
  });
});

describe("listWabas", () => {
  it("unions owned and client-shared accounts, and one failing edge doesn't hide the other", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("owned_whatsapp_business_accounts")) {
        return jsonResponse({ data: [{ id: "W1", name: "Firm A" }, { id: "W2", name: "Firm B" }] });
      }
      return jsonResponse({ error: { message: "(#200) Permissions error", code: 200 } }, 403);
    });
    const res = await listWabas("BIZ", { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.wabas.map((w) => w.id)).toEqual(["W1", "W2"]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("client_whatsapp_business_accounts");
  });

  it("follows paging.next", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("client_")) return jsonResponse({ data: [] });
      if (url.includes("after=CUR")) return jsonResponse({ data: [{ id: "W2" }] });
      return jsonResponse({
        data: [{ id: "W1" }],
        paging: { next: `https://graph.facebook.com/${GRAPH_API_VERSION}/BIZ/owned_whatsapp_business_accounts?fields=id,name&after=CUR` },
      });
    });
    const res = await listWabas("BIZ", { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.wabas.map((w) => w.id)).toEqual(["W1", "W2"]);
  });
});

describe("registerPhoneNumber", () => {
  it("POSTs messaging_product + pin to /{id}/register and returns Meta's body verbatim", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"success":true}', { status: 200 }));
    const res = await registerPhoneNumber("1300563326480454", "000000", {
      token: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res).toEqual({ httpStatus: 200, body: '{"success":true}' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}/1300563326480454/register`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ messaging_product: "whatsapp", pin: "000000" });
  });

  it("returns an error response as-is instead of throwing, so the page can show it", async () => {
    const raw = '{"error":{"message":"(#133005) Two step verification PIN Mismatch","code":133005}}';
    const fetchImpl = vi.fn(async () => new Response(raw, { status: 400 }));
    const res = await registerPhoneNumber("PN", "111111", { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ httpStatus: 400, body: raw });
  });
});
