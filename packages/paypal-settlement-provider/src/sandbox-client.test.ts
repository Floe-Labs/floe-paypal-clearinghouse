import { describe, expect, it } from "vitest";
import { DEMO_CLEARED_WORK_STATEMENT } from "../../../apps/clearinghouse-workbench/src/workbench-engine.js";
import {
  PayPalClearinghouseClient,
  type ClearedWorkStatementInput,
  type PayPalWebhookEvent,
} from "./index.js";

describe("PayPalClearinghouseClient — Sandbox REST API Client (Orders v2, Capture, Payouts & Webhook Verify)", () => {
  it("Uses Sandbox payeeMerchantId 4MWDGZ4MWSE5J, caches OAuth2 tokens, and executes Orders v2 AUTHORIZE, split CAPTURE, and webhook verification", async () => {
    expect(DEMO_CLEARED_WORK_STATEMENT.payeeMerchantId).toBe("4MWDGZ4MWSE5J");

    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({ access_token: "sandbox_oauth_tok_123", expires_in: 32400 }),
          { status: 200 },
        );
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
    const rawBody = `{\n  "id": "${event.id}",\n  "event_type": "${event.event_type}",\n  "resource": { "id": "CAP-SANDBOX-01", "amount": { "currency_code": "USD", "value": "4334.22" } },\n  "create_time": "${event.create_time}"\n}`;
    const headers = {
      transmissionId: "tx-1",
      transmissionTime: "2026-10-31T02:01:01Z",
      transmissionSig: "base64sig==",
      certUrl: "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-123",
      authAlgo: "SHA256withRSA",
    };

    const whFirst = await client.verifyWebhookViaPayPalApi({ rawBody, headers });
    expect(whFirst.verified).toBe(true);
    expect(whFirst.duplicate).toBe(false);
    expect(String(calls[3]?.init?.body)).toContain(`"webhook_event":${rawBody}`);
    expect(calls[3]?.init?.signal).toBeDefined();

    const whReplay = await client.verifyWebhookViaPayPalApi({
      rawBody,
      headers,
      processedEventIds: whFirst.nextProcessedEventIds,
    });
    expect(whReplay.verified).toBe(true);
    expect(whReplay.duplicate).toBe(true);
    // 1 OAuth token call (cached across subsequent calls) + 1 order + 1 capture + 2 webhook verify calls = 5
    expect(calls).toHaveLength(5);
  });

  it("Executes createMultiVendorPayoutBatch for payable statements and skips HTTP call when total payable is 0n", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, init });
      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(
          JSON.stringify({ access_token: "payout_tok_123", expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (url.endsWith("/v1/payments/payouts")) {
        return new Response(
          JSON.stringify({ batch_header: { payout_batch_id: "BATCH-SANDBOX-01", batch_status: "PENDING" } }),
          { status: 201 },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const client = new PayPalClearinghouseClient({
      clientId: "test_client",
      clientSecret: "test_secret",
      fetchFn: mockFetch,
    });

    const zeroPayableStmt: ClearedWorkStatementInput = {
      ...DEMO_CLEARED_WORK_STATEMENT,
      statementId: "CWS-ZERO-01",
      lines: [
        {
          lineKey: "L-ZERO",
          description: "Excluded line",
          billedMicro: 100_000_000n,
          clearedPayableMicro: 0n,
          excludedCreditMicro: 100_000_000n,
          heldInDisputeMicro: 0n,
          tClass: "T2",
          reasonCode: "FIN_UNVERIFIED_OUTCOME",
          evidenceRefs: ["ev:zero"],
        },
      ],
    };

    const emptyRes = await client.createMultiVendorPayoutBatch("BATCH-EMPTY", [zeroPayableStmt]);
    expect(emptyRes.payload.items).toHaveLength(0);
    expect(emptyRes.batchResponse).toBeNull();
    expect(calls).toHaveLength(0);

    const activeRes = await client.createMultiVendorPayoutBatch("BATCH-ACTIVE-01", [DEMO_CLEARED_WORK_STATEMENT]);
    expect(activeRes.payload.items).toHaveLength(1);
    expect(activeRes.payload.items[0]?.receiver).toBe("4MWDGZ4MWSE5J");
    expect(activeRes.batchResponse).toEqual({
      batch_header: { payout_batch_id: "BATCH-SANDBOX-01", batch_status: "PENDING" },
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual(activeRes.payload);
  });

  it("Rejects webhook verification on FAILURE status, untrusted certUrl, invalid authAlgo, missing webhookId, and supports claimEventId", async () => {
    let verifyStatus = "FAILURE";
    const calls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      if (url.endsWith("/v1/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok_1", expires_in: 3600 }), { status: 200 });
      }
      if (url.endsWith("/v1/notifications/verify-webhook-signature")) {
        return new Response(JSON.stringify({ verification_status: verifyStatus }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    };

    const client = new PayPalClearinghouseClient({
      clientId: "test_client",
      clientSecret: "test_secret",
      webhookId: "WH-ID-01",
      fetchFn: mockFetch,
    });

    const rawBody = JSON.stringify({
      id: "WH-EVT-NEG-01",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: "CAP-01" },
      create_time: "2026-10-31T02:01:00Z",
    });
    const validHeaders = {
      transmissionId: "tx-neg-1",
      transmissionTime: "2026-10-31T02:01:01Z",
      transmissionSig: "sig==",
      certUrl: "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-123",
      authAlgo: "SHA256withRSA",
    };

    // 1. Untrusted certUrl host -> 0 API calls
    const untrustedRes = await client.verifyWebhookViaPayPalApi({
      rawBody,
      headers: { ...validHeaders, certUrl: "https://evil.example.com/cert.pem" },
    });
    expect(untrustedRes.verified).toBe(false);
    expect(calls).toHaveLength(0);

    // 2. Unsupported authAlgo and empty webhookId -> 0 API calls
    const badAlgoRes = await client.verifyWebhookViaPayPalApi({
      rawBody,
      headers: { ...validHeaders, authAlgo: "NONE" },
    });
    expect(badAlgoRes.verified).toBe(false);
    const noWebhookClient = new PayPalClearinghouseClient({
      clientId: "test_client",
      clientSecret: "test_secret",
      fetchFn: mockFetch,
    });
    const noWhIdRes = await noWebhookClient.verifyWebhookViaPayPalApi({
      rawBody,
      headers: validHeaders,
      webhookId: "",
    });
    expect(noWhIdRes.verified).toBe(false);
    expect(calls).toHaveLength(0);

    // 3. verification_status !== "SUCCESS" -> verified: false, nextProcessedEventIds unchanged
    const initialSet = new Set<string>(["EXISTING-1"]);
    const failureRes = await client.verifyWebhookViaPayPalApi({
      rawBody,
      headers: validHeaders,
      processedEventIds: initialSet,
    });
    expect(failureRes.verified).toBe(false);
    expect(failureRes.nextProcessedEventIds).toBe(initialSet);
    expect(calls).toHaveLength(2);

    // 4. claimEventId returning false -> duplicate: true, nextProcessedEventIds unchanged
    verifyStatus = "SUCCESS";
    const claimedFalseRes = await client.verifyWebhookViaPayPalApi({
      rawBody,
      headers: validHeaders,
      processedEventIds: initialSet,
      claimEventId: () => false,
    });
    expect(claimedFalseRes.verified).toBe(true);
    expect(claimedFalseRes.duplicate).toBe(true);
    expect(claimedFalseRes.nextProcessedEventIds).toBe(initialSet);
    expect(calls).toHaveLength(3);
  });
});
