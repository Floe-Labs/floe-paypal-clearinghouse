import {
  buildMultiVendorPayoutBatch,
  buildPayPalOrderAuthorization,
  buildPayPalSplitCapturePlan,
  isTrustedPayPalCertUrl,
  type ClearedWorkStatementInput,
  type PayPalOrderV2AuthPayload,
  type PayPalPayoutBatchPayload,
  type PayPalSplitCapturePlan,
  type PayPalTransmissionHeaders,
  type PayPalWebhookEvent,
} from "./index.js";

export type PayPalEnvironment = "sandbox" | "live";

export interface PayPalClearinghouseClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly environment?: PayPalEnvironment;
  readonly webhookId?: string;
  readonly requestTimeoutMs?: number;
  readonly fetchFn?: typeof fetch;
}

export interface PayPalOrderV2Response {
  readonly id: string;
  readonly status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  readonly links?: readonly { readonly href: string; readonly rel: string; readonly method: string }[];
}

export interface PayPalCaptureResponse {
  readonly id: string;
  readonly status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  readonly final_capture?: boolean;
  readonly amount?: { readonly currency_code: string; readonly value: string };
}

function resolvePayPalBaseUrl(env: PayPalEnvironment): string {
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export class PayPalClearinghouseClient {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookId?: string;
  private readonly fetchFn: typeof fetch;
  private cachedToken?: { readonly value: string; readonly expiresAtMs: number };

  constructor(config: PayPalClearinghouseClientConfig) {
    if (!config.clientId.trim() || !config.clientSecret.trim()) {
      throw new Error("PayPalClearinghouseClient requires non-empty clientId and clientSecret.");
    }
    const timeoutMs = config.requestTimeoutMs ?? 15_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("PayPalClearinghouseClient requires a positive finite requestTimeoutMs.");
    }
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.webhookId = config.webhookId;
    this.baseUrl = resolvePayPalBaseUrl(config.environment ?? "sandbox");
    const baseFetch = config.fetchFn ?? fetch;
    this.fetchFn = (input, init) =>
      baseFetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      });
  }

  async fetchAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs) {
      return this.cachedToken.value;
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`, "utf8").toString("base64");
    const res = await this.fetchFn(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(`PayPal OAuth2 token exchange failed with status ${res.status}.`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new Error("PayPal OAuth2 response did not contain an access_token.");
    }
    const ttlSeconds =
      typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
        ? Math.max(0, body.expires_in - 60)
        : 0;
    if (ttlSeconds > 0) {
      this.cachedToken = {
        value: body.access_token,
        expiresAtMs: Date.now() + ttlSeconds * 1000,
      };
    }
    return body.access_token;
  }

  async createOrderAuthorization(statement: ClearedWorkStatementInput): Promise<{
    readonly payload: PayPalOrderV2AuthPayload;
    readonly order: PayPalOrderV2Response;
  }> {
    const payload = buildPayPalOrderAuthorization(statement);
    const token = await this.fetchAccessToken();
    const res = await this.fetchFn(`${this.baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": payload.payPalRequestId,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        intent: payload.intent,
        purchase_units: payload.purchase_units,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`PayPal Orders v2 create failed (${res.status}): ${errText}`);
    }
    const order = (await res.json()) as PayPalOrderV2Response;
    return { payload, order };
  }

  async captureAuthorizedWork(
    statement: ClearedWorkStatementInput,
    orderId: string,
    authorizationId: string,
  ): Promise<{
    readonly plan: PayPalSplitCapturePlan;
    readonly capture: PayPalCaptureResponse | null;
  }> {
    const plan = buildPayPalSplitCapturePlan(statement, orderId, authorizationId);
    if (!plan.capturePayload) {
      return { plan, capture: null };
    }
    const token = await this.fetchAccessToken();
    const res = await this.fetchFn(
      `${this.baseUrl}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": plan.payPalRequestId,
          Prefer: "return=representation",
        },
        body: JSON.stringify(plan.capturePayload),
      },
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`PayPal Authorizations capture failed (${res.status}): ${errText}`);
    }
    const capture = (await res.json()) as PayPalCaptureResponse;
    return { plan, capture };
  }

  async createMultiVendorPayoutBatch(
    batchId: string,
    statements: readonly ClearedWorkStatementInput[],
  ): Promise<{
    readonly payload: PayPalPayoutBatchPayload;
    readonly batchResponse: Record<string, unknown> | null;
  }> {
    const payload = buildMultiVendorPayoutBatch(batchId, statements);
    if (payload.items.length === 0) {
      return { payload, batchResponse: null };
    }
    const token = await this.fetchAccessToken();
    const res = await this.fetchFn(`${this.baseUrl}/v1/payments/payouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`PayPal Payouts batch create failed (${res.status}): ${errText}`);
    }
    const batchResponse = (await res.json()) as Record<string, unknown>;
    return { payload, batchResponse };
  }

  async verifyWebhookViaPayPalApi(input: {
    readonly rawBody: string;
    readonly headers: PayPalTransmissionHeaders;
    readonly webhookId?: string;
    readonly processedEventIds?: ReadonlySet<string>;
    readonly claimEventId?: (eventId: string) => boolean;
  }): Promise<{
    readonly verified: boolean;
    readonly duplicate: boolean;
    readonly eventId: string | null;
    readonly event: PayPalWebhookEvent | null;
    readonly nextProcessedEventIds: ReadonlySet<string>;
  }> {
    const existingSet = input.processedEventIds ?? new Set<string>();
    const webhookId = input.webhookId ?? this.webhookId;
    const { headers } = input;
    if (
      !webhookId ||
      !headers.transmissionId ||
      !headers.transmissionTime ||
      !headers.transmissionSig ||
      headers.authAlgo !== "SHA256withRSA" ||
      !isTrustedPayPalCertUrl(headers.certUrl)
    ) {
      return { verified: false, duplicate: false, eventId: null, event: null, nextProcessedEventIds: existingSet };
    }
    let parsed: PayPalWebhookEvent;
    try {
      parsed = JSON.parse(input.rawBody) as PayPalWebhookEvent;
      if (!parsed || typeof parsed.id !== "string" || !parsed.id) {
        return { verified: false, duplicate: false, eventId: null, event: null, nextProcessedEventIds: existingSet };
      }
    } catch {
      return { verified: false, duplicate: false, eventId: null, event: null, nextProcessedEventIds: existingSet };
    }
    const token = await this.fetchAccessToken();
    const verifyBody = `{"auth_algo":${JSON.stringify(headers.authAlgo)},"cert_url":${JSON.stringify(headers.certUrl)},"transmission_id":${JSON.stringify(headers.transmissionId)},"transmission_sig":${JSON.stringify(headers.transmissionSig)},"transmission_time":${JSON.stringify(headers.transmissionTime)},"webhook_id":${JSON.stringify(webhookId)},"webhook_event":${input.rawBody}}`;
    const res = await this.fetchFn(`${this.baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: verifyBody,
    });
    if (!res.ok) {
      return { verified: false, duplicate: false, eventId: null, event: null, nextProcessedEventIds: existingSet };
    }
    const body = (await res.json()) as { verification_status?: string };
    if (body.verification_status !== "SUCCESS") {
      return { verified: false, duplicate: false, eventId: null, event: null, nextProcessedEventIds: existingSet };
    }
    const claimed = input.claimEventId ? input.claimEventId(parsed.id) : !existingSet.has(parsed.id);
    if (!claimed) {
      return { verified: true, duplicate: true, eventId: parsed.id, event: parsed, nextProcessedEventIds: existingSet };
    }
    const next = new Set(existingSet);
    next.add(parsed.id);
    return { verified: true, duplicate: false, eventId: parsed.id, event: parsed, nextProcessedEventIds: next };
  }
}
