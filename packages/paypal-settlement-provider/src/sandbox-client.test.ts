import { describe, expect, it } from "vitest";
import { DEMO_CLEARED_WORK_STATEMENT } from "../../../apps/clearinghouse-workbench/src/workbench-engine.js";
import { PayPalClearinghouseClient, type PayPalWebhookEvent } from "./index.js";

describe("PayPalClearinghouseClient — Sandbox REST API Client (Orders v2, Capture, Payouts & Webhook Verify)", () => {
  it("Uses Sandbox payeeMerchantId 4MWDGZ4MWSE5J and executes Orders v2 AUTHORIZE, split CAPTURE, and webhook verification", async () => {
    expect(DEMO_CLEARED_WORK_STATEMENT.payeeMerchantId).toBe("4MWDGZ4MWSE5J");

    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "sandbox_oauth_tok_123" }), { status: 200 });
      }
      if (url.endsWith("/v2/checkout/orders")) {
        return new Response(JSON.stringify({ id: "ORD-SANDBOX-01", status: "CREATED" }), { status: 201 });
      }
      if (url.includes("/v2/payments/authorizations/") && url.endsWith("/capture")) {
        return new Response(
          JSON.stringify({
            id: "CAP-SANDBOX-01",
            status: "COMPLETED",
            final_capture: false,
            amount: { currency_code: "USD", value: "4334.22" },
          }),
          { status: 201 },
        );
      }
      if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
        return new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    };

    const client = new PayPalClearinghouseClient({
      clientId: "test_sandbox_client_id",
      clientSecret: "test_sandbox_client_secret",
      environment: "sandbox",
      webhookId: "WH-ID-SANDBOX-01",
      fetchFn: mockFetch,
    });

    const { payload, order } = await client.createOrderAuthorization(DEMO_CLEARED_WORK_STATEMENT);
    expect(order.id).toBe("ORD-SANDBOX-01");
    expect(payload.purchase_units[0].payee.merchant_id).toBe("4MWDGZ4MWSE5J");

    const { plan, capture } = await client.captureAuthorizedWork(
      DEMO_CLEARED_WORK_STATEMENT,
      order.id,
      "AUTH-SANDBOX-01",
    );
    expect(capture?.id).toBe("CAP-SANDBOX-01");
    expect(plan.capturePayload?.amount.value).toBe("4334.22");

    const event: PayPalWebhookEvent = {
      id: "WH-EVT-SANDBOX-99",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP-SANDBOX-01", amount: { currency_code: "USD", value: "4334.22" } },
      create_time: "2026-10-31T02:01:00Z",
    };
    const rawBody = JSON.stringify(event);
    const headers = {
      transmissionId: "tx-1",
      transmissionTime: "2026-10-31T02:01:01Z",
      transmissionSig: "base64sig==",
      certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123",
      authAlgo: "SHA256withRSA",
    };

    const whFirst = await client.verifyWebhookViaPayPalApi({ rawBody, headers });
    expect(whFirst.verified).toBe(true);
    expect(whFirst.duplicate).toBe(false);

    const whReplay = await client.verifyWebhookViaPayPalApi({
      rawBody,
      headers,
      processedEventIds: whFirst.nextProcessedEventIds,
    });
    expect(whReplay.verified).toBe(true);
    expect(whReplay.duplicate).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });
});
