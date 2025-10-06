import 'dotenv/config';
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import WebSocket from "ws";
import { buildInstructions, buildGreeting } from './lib/instructionBuilder.js';
import { transferCall, getTransferTool } from './lib/callTransfer.js';

const app = express();
const greetedCalls = new Set();
const activeFunctionHandlers = new Set();

// Configuration
const GREETING_DELAY_MS = Number(process.env.GREETING_DELAY_MS ?? 400);
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-realtime-preview-2024-12-17";
const VOICE = process.env.OPENAI_VOICE ?? "shimmer";
const PORT = Number(process.env.PORT ?? 8000);
const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === "true";

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString(); // save raw body before parsing
    },
  })
);

console.log("Webhook secret loaded:", process.env.OPENAI_WEBHOOK_SECRET ? "yes" : "no");

function verifySignature(req) {
  const webhookId = req.get("webhook-id");
  const timestamp = req.get("webhook-timestamp");
  const signatureHeader = req.get("webhook-signature");

  if (!signatureHeader || !timestamp || !webhookId) {
    console.warn("Missing signature headers", { webhookId, timestamp, signatureHeader });
    return false;
  }

  const payload = `${webhookId}.${timestamp}.${req.rawBody}`;

  // Strip wwhsec_ prefix and base64-decode the secret
  const secretString = process.env.OPENAI_WEBHOOK_SECRET?.replace(/^whsec_/, '');
  if (!secretString) {
    console.error("OPENAI_WEBHOOK_SECRET is not configured");
    return false;
  }
  const secret = Buffer.from(secretString, 'base64');

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64");

  // Parse signatures in format "v1,signature" or "v1,sig1 v1,sig2"
  const sigs = signatureHeader.split(" ").flatMap(s => {
    const parts = s.trim().split(",");
    return parts.length > 1 ? parts.slice(1) : parts;
  });

  const valid = sigs.includes(expected);
  if (!valid) {
    console.warn("Signature validation failed", { webhookId, timestamp, signatureHeader });
  }
  return valid;
}

function logCallEvent(type, data, extra) {
  const callId = data?.call_id ?? data?.call?.id ?? "unknown";
  const sessionId = data?.session_id ?? data?.session?.id ?? "unknown";
  const leg = data?.leg ?? "?";
  const status = data?.status ?? data?.connection_state ?? data?.reason ?? "";
  const suffix = extra ? ` ${extra}` : "";
  console.log(`[${type}] call=${callId} session=${sessionId} leg=${leg} status=${status}${suffix}`);
}

function extractPhoneNumber(sipHeaders) {
  const fromHeader = sipHeaders?.find(h => h.name === "From")?.value || "";
  const phoneMatch = fromHeader.match(/\+?(\d{10,})/);
  return phoneMatch ? phoneMatch[1] : "unknown";
}

function extractTwilioCallSid(sipHeaders) {
  const callSidHeader = sipHeaders?.find(h => h.name === "X-Twilio-CallSid");
  console.log("Extracted Twilio CallSid header:", callSidHeader);
  return callSidHeader?.value || null;
}

async function acceptCall(callId, instructions, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetch(
      `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(callId)}/accept`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "realtime",
          model: MODEL,
          instructions: instructions,
          audio: {
            output: { voice: VOICE }
          },
          tools: [getTransferTool()]  // Add call transfer capability
        }),
      }
    );

    if (response.ok) {
      return response;
    }

    const error = await response.text();

    // Retry on 404 (call not ready yet)
    if (response.status === 404 && attempt < retries) {
      console.log(`[accept] Call not ready yet (attempt ${attempt}/${retries}), retrying in 500ms...`);
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }

    throw new Error(`Accept failed (${response.status}): ${error}`);
  }
}

async function triggerGreeting(callId, greetingMessage, reason) {
  if (VERBOSE_LOGGING) {
    console.log(`[greeting] called with callId=${callId} reason=${reason}`);
  }

  if (!callId) {
    console.warn(`[greeting] no call id; skip trigger (reason=${reason})`);
    return false;
  }

  if (greetedCalls.has(callId)) {
    if (VERBOSE_LOGGING) {
      console.log(`[greeting] already sent for call=${callId} (reason=${reason})`);
    }
    return true;
  }

  console.log(`[greeting] triggering for call=${callId} with ${GREETING_DELAY_MS}ms delay`);
  greetedCalls.add(callId);

  if (GREETING_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, GREETING_DELAY_MS));
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    ws.on("open", () => {
      console.log(`[greeting] WebSocket connected for call=${callId}`);
      ws.send(JSON.stringify({
        type: "response.create",
        response: {
          instructions: `Say to the caller: '${greetingMessage}'`
        },
      }));

      // Close after sending greeting
      setTimeout(() => ws.close(), 1000);
      resolve(true);
    });

    ws.on("message", (data) => {
      if (VERBOSE_LOGGING) {
        console.log(`[greeting] WebSocket message for call=${callId}:`, data.toString());
      }
    });

    ws.on("error", (error) => {
      console.error(`[greeting] WebSocket error for call=${callId}:`, error.message);
      greetedCalls.delete(callId);
      resolve(false);
    });

    ws.on("close", () => {
      if (VERBOSE_LOGGING) {
        console.log(`[greeting] WebSocket disconnected for call=${callId}`);
      }
    });
  });
}

async function handleIncomingCall(data, res) {
  const { call_id } = data;
  const callerPhone = extractPhoneNumber(data.sip_headers);
  const twilioCallSid = extractTwilioCallSid(data.sip_headers);

  console.log(`[incoming] call=${call_id} caller=${callerPhone} twilioSid=${twilioCallSid}`);

  try {
    // Build personalized instructions and greeting based on caller
    const [instructions, greetingMessage] = await Promise.all([
      buildInstructions(callerPhone),
      buildGreeting(callerPhone)
    ]);

    await acceptCall(call_id, instructions);
    console.log(`[incoming] call accepted for call=${call_id}`);

    startFunctionHandler(call_id);

    // Trigger personalized greeting via WebSocket (non-blocking)
    triggerGreeting(call_id, greetingMessage, "after accept").catch(err => {
      console.error(`[incoming] greeting failed for call=${call_id}:`, err);
    });

    return res.status(200).send("ok");
  } catch (error) {
    console.error(`[incoming] error accepting call=${call_id}:`, error.message);
    return res.status(500).send("Accept failed");
  }
}

function startFunctionHandler(callId) {
  if (!callId) {
    return;
  }

  if (activeFunctionHandlers.has(callId)) {
    return;
  }

  console.log(`[function] Launching handler for call=${callId}`);
  activeFunctionHandlers.add(callId);

  handleFunctionCalls(callId)
    .catch(err => {
      console.error(`[function] Handler error for call=${callId}:`, err);
    })
    .finally(() => {
      activeFunctionHandlers.delete(callId);
    });
}

async function handleFunctionCalls(callId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    ws.on("open", () => {
      console.log(`[function] WebSocket connected for call=${callId}`);
    });

    ws.on("message", async (data) => {
      const event = JSON.parse(data.toString());

      if (event.type === "response.function_call_arguments.done") {
        const { call_id: functionCallId, name, arguments: argsJson } = event;
        console.log(`[function] Function call: ${name} with args: ${argsJson}`);

        if (name === "transfer_call") {
          const args = JSON.parse(argsJson);

          const result = await transferCall(callId, args.destination);

          // Send function call result back
          ws.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: functionCallId,
              output: JSON.stringify(result)
            }
          }));

          // Request response generation
          ws.send(JSON.stringify({ type: "response.create" }));
        }
      }
    });

    ws.on("error", (error) => {
      console.error(`[function] WebSocket error for call=${callId}:`, error.message);
      resolve(false);
    });

    ws.on("close", () => {
      console.log(`[function] WebSocket disconnected for call=${callId}`);
      resolve(true);
    });
  });
}

// Health check endpoint for Docker
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/openai-webhook", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).send("invalid signature");
  }

  const { type, data } = req.body;
  logCallEvent(type, data);

  if (type === "realtime.call.incoming") {
    return await handleIncomingCall(data, res);
  }

  // Handle function calls for transfers
  if (type === "realtime.session.updated" && data.session?.tools) {
    startFunctionHandler(data.call_id);
  }

  // Cleanup events - remove call from greeted set
  const cleanupEvents = [
    "realtime.call.ended",
    "realtime.call.failed",
    "realtime.call.disconnected",
    "realtime.call.participant.disconnected"
  ];

  if (cleanupEvents.includes(type)) {
    const { call_id } = data;
    greetedCalls.delete(call_id);
    return res.send("ok");
  }

  if (type.startsWith("realtime.")) {
    console.log(`[unhandled] realtime event type=${type}, payload:`, JSON.stringify({ type, data }, null, 2));
  } else {
    console.log(`[unhandled] non-realtime webhook:`, JSON.stringify(req.body, null, 2));
  }

  res.send("ok");
});

app.listen(PORT, () => console.log(`Listening on :${PORT}`));
