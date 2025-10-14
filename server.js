import 'dotenv/config';
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import WebSocket from "ws";
import { buildInstructions, buildGreeting } from './lib/instructionBuilder.js';
import { transferCall, getTransferTool } from './lib/callTransfer.js';
import { clearCache } from './lib/dataAccess.js';

// Validate required environment variables at startup
const requiredEnvVars = ['OPENAI_API_KEY', 'OPENAI_WEBHOOK_SECRET'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('Please set these variables in your .env file or environment');
  process.exit(1);
}

const app = express();
const greetedCalls = new Set();
const activeFunctionHandlers = new Set();
const callStates = new Map(); // Track call state and metadata

// Configuration
const GREETING_DELAY_MS = Number(process.env.GREETING_DELAY_MS ?? 400);
const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-realtime-preview-2024-12-17";
const VOICE = process.env.OPENAI_VOICE ?? "shimmer";
const PORT = Number(process.env.PORT ?? 9000);
const VERBOSE_LOGGING = process.env.VERBOSE_LOGGING === "true";

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString(); // save raw body before parsing
    },
  })
);

// Structured logging system
function logEvent(level, category, callId, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    category,
    callId: callId || 'system',
    message,
    ...metadata
  };

  // Use console methods based on level
  if (level === 'error') {
    console.error(JSON.stringify(logEntry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(logEntry));
  } else if (VERBOSE_LOGGING || level === 'info') {
    console.log(JSON.stringify(logEntry));
  }
}

// Legacy log format for backwards compatibility
function logSimple(message) {
  console.log(message);
}

logEvent('info', 'startup', null, 'Server initializing', {
  model: MODEL,
  voice: VOICE,
  port: PORT,
  greetingDelay: GREETING_DELAY_MS,
  verboseLogging: VERBOSE_LOGGING
});

function verifySignature(req) {
  const webhookId = req.get("webhook-id");
  const timestamp = req.get("webhook-timestamp");
  const signatureHeader = req.get("webhook-signature");

  if (!signatureHeader || !timestamp || !webhookId) {
    logEvent('warn', 'webhook', null, 'Missing signature headers', {
      hasWebhookId: !!webhookId,
      hasTimestamp: !!timestamp,
      hasSignature: !!signatureHeader
    });
    return false;
  }

  const payload = `${webhookId}.${timestamp}.${req.rawBody}`;

  // Strip wwhsec_ prefix and base64-decode the secret
  const secretString = process.env.OPENAI_WEBHOOK_SECRET?.replace(/^whsec_/, '');
  if (!secretString) {
    logEvent('error', 'webhook', null, 'OPENAI_WEBHOOK_SECRET not configured');
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
    logEvent('warn', 'webhook', null, 'Signature validation failed', {
      webhookId,
      timestamp
    });
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
  const startTime = Date.now();

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
            input: {
              format: "pcm16",
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 500
              }
            },
            output: {
              voice: VOICE,
              format: "pcm16"
            }
          },
          tools: [getTransferTool()]  // Add call transfer capability
        }),
      }
    );

    if (response.ok) {
      const duration = Date.now() - startTime;
      logEvent('info', 'accept', callId, 'Call accepted', {
        durationMs: duration,
        attempts: attempt
      });
      return response;
    }

    const error = await response.text();

    // Retry on 404 (call not ready yet)
    if (response.status === 404 && attempt < retries) {
      logEvent('warn', 'accept', callId, 'Call not ready, retrying', {
        attempt,
        maxRetries: retries
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }

    throw new Error(`Accept failed (${response.status}): ${error}`);
  }
}

async function triggerGreeting(callId, greetingMessage, reason) {
  if (VERBOSE_LOGGING) {
    logEvent('debug', 'greeting', callId, 'Greeting function called', { reason });
  }

  if (!callId) {
    logEvent('warn', 'greeting', null, 'No call ID provided, skipping greeting', { reason });
    return false;
  }

  if (greetedCalls.has(callId)) {
    if (VERBOSE_LOGGING) {
      logEvent('debug', 'greeting', callId, 'Greeting already sent', { reason });
    }
    return true;
  }

  logEvent('info', 'greeting', callId, 'Triggering greeting', {
    delayMs: GREETING_DELAY_MS,
    reason
  });
  greetedCalls.add(callId);

  if (GREETING_DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, GREETING_DELAY_MS));
  }

  return new Promise((resolve) => {
    let connectionTimeout = null;

    const ws = new WebSocket(
      `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    // Connection timeout (10 seconds)
    connectionTimeout = setTimeout(() => {
      logEvent('error', 'greeting', callId, 'WebSocket connection timeout');
      ws?.close();
      greetedCalls.delete(callId);
      resolve(false);
    }, 10000);

    ws.on("open", () => {
      clearTimeout(connectionTimeout);
      logEvent('info', 'greeting', callId, 'WebSocket connected, sending greeting');

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
        try {
          const event = JSON.parse(data.toString());
          logEvent('debug', 'greeting', callId, 'WebSocket message received', {
            eventType: event.type
          });
        } catch (e) {
          logEvent('debug', 'greeting', callId, 'WebSocket message received (raw)', {
            data: data.toString().substring(0, 100)
          });
        }
      }
    });

    ws.on("error", (error) => {
      clearTimeout(connectionTimeout);
      logEvent('error', 'greeting', callId, 'WebSocket error', {
        error: error.message,
        code: error.code
      });
      greetedCalls.delete(callId);
      resolve(false);
    });

    ws.on("close", (code, reason) => {
      clearTimeout(connectionTimeout);
      if (VERBOSE_LOGGING) {
        logEvent('debug', 'greeting', callId, 'WebSocket disconnected', {
          code,
          reason: reason.toString()
        });
      }
    });
  });
}

async function handleIncomingCall(data, res) {
  const startTime = Date.now();
  const { call_id } = data;
  const callerPhone = extractPhoneNumber(data.sip_headers);
  const twilioCallSid = extractTwilioCallSid(data.sip_headers);

  logEvent('info', 'incoming', call_id, 'Incoming call received', {
    callerPhone,
    twilioCallSid
  });

  try {
    // Build personalized instructions and greeting based on caller
    const [instructions, greetingMessage] = await Promise.all([
      buildInstructions(callerPhone),
      buildGreeting(callerPhone)
    ]);

    await acceptCall(call_id, instructions);

    const callSetupDuration = Date.now() - startTime;
    logEvent('info', 'incoming', call_id, 'Call setup completed', {
      durationMs: callSetupDuration
    });

    startFunctionHandler(call_id);

    // Trigger personalized greeting via WebSocket (non-blocking)
    triggerGreeting(call_id, greetingMessage, "after accept").catch(err => {
      logEvent('error', 'incoming', call_id, 'Greeting failed', {
        error: err.message,
        stack: err.stack
      });
    });

    return res.status(200).send("ok");
  } catch (error) {
    logEvent('error', 'incoming', call_id, 'Call setup failed', {
      error: error.message,
      stack: error.stack,
      durationMs: Date.now() - startTime
    });
    return res.status(500).send("Accept failed");
  }
}

function startFunctionHandler(callId) {
  if (!callId) {
    logEvent('warn', 'function', null, 'Cannot start function handler without call ID');
    return;
  }

  if (activeFunctionHandlers.has(callId)) {
    logEvent('debug', 'function', callId, 'Function handler already active');
    return;
  }

  logEvent('info', 'function', callId, 'Launching function handler');
  activeFunctionHandlers.add(callId);

  handleFunctionCalls(callId)
    .catch(err => {
      logEvent('error', 'function', callId, 'Handler error', {
        error: err.message,
        stack: err.stack
      });
    })
    .finally(() => {
      activeFunctionHandlers.delete(callId);
      logEvent('info', 'function', callId, 'Function handler stopped');
    });
}

async function handleFunctionCalls(callId) {
  return new Promise((resolve) => {
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 3;
    let ws = null;
    let connectionTimeout = null;
    let heartbeatInterval = null;

    const connect = () => {
      ws = new WebSocket(
        `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,
        {
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          },
        }
      );

      // Connection timeout (30 seconds)
      connectionTimeout = setTimeout(() => {
        logEvent('error', 'function', callId, 'WebSocket connection timeout');
        ws?.close();
      }, 30000);

      ws.on("open", () => {
        clearTimeout(connectionTimeout);
        reconnectAttempts = 0;
        logEvent('info', 'function', callId, 'WebSocket connected');

        // Initialize call state tracking
        callStates.set(callId, {
          started: Date.now(),
          lastActivity: Date.now(),
          messageCount: 0,
          interrupted: false
        });

        // Heartbeat to detect stale connections
        heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          }
        }, 15000);
      });

      ws.on("pong", () => {
        if (VERBOSE_LOGGING) {
          logEvent('debug', 'function', callId, 'Heartbeat pong received');
        }
      });

      ws.on("message", async (data) => {
        try {
          const event = JSON.parse(data.toString());

          // Update call state
          const state = callStates.get(callId);
          if (state) {
            state.lastActivity = Date.now();
            state.messageCount++;
          }

          // Handle interrupt/speech detection
          if (event.type === "input_audio_buffer.speech_started") {
            logEvent('info', 'interrupt', callId, 'User speech detected, clearing buffers');
            if (state) {
              state.interrupted = true;
            }
            // Clear audio buffer to prevent overlap
            ws.send(JSON.stringify({
              type: "input_audio_buffer.clear"
            }));
          }

          // Handle speech stopped
          if (event.type === "input_audio_buffer.speech_stopped") {
            if (VERBOSE_LOGGING) {
              logEvent('debug', 'interrupt', callId, 'User speech stopped');
            }
          }

          // Track response completion
          if (event.type === "response.done") {
            logEvent('info', 'response', callId, 'AI response completed', {
              messageCount: state?.messageCount || 0
            });
          }

          // Handle function calls
          if (event.type === "response.function_call_arguments.done") {
            const { call_id: functionCallId, name, arguments: argsJson } = event;
            logEvent('info', 'function', callId, `Function call: ${name}`, {
              args: argsJson
            });

            if (name === "transfer_call") {
              const args = JSON.parse(argsJson);
              const transferStartTime = Date.now();

              const result = await transferCall(callId, args.destination);

              logEvent('info', 'transfer', callId, 'Transfer completed', {
                destination: args.destination,
                success: result.success,
                durationMs: Date.now() - transferStartTime
              });

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
        } catch (error) {
          logEvent('error', 'function', callId, 'Error processing message', {
            error: error.message,
            stack: error.stack
          });
        }
      });

      ws.on("error", (error) => {
        clearTimeout(connectionTimeout);
        clearInterval(heartbeatInterval);
        logEvent('error', 'function', callId, 'WebSocket error', {
          error: error.message,
          reconnectAttempts
        });

        // Attempt reconnection if possible
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 5000);
          logEvent('info', 'function', callId, 'Attempting reconnection', {
            attempt: reconnectAttempts,
            delayMs: backoffMs
          });
          setTimeout(connect, backoffMs);
        } else {
          logEvent('error', 'function', callId, 'Max reconnection attempts reached');
          resolve(false);
        }
      });

      ws.on("close", (code, reason) => {
        clearTimeout(connectionTimeout);
        clearInterval(heartbeatInterval);

        const state = callStates.get(callId);
        const sessionDuration = state ? Date.now() - state.started : 0;

        logEvent('info', 'function', callId, 'WebSocket disconnected', {
          code,
          reason: reason.toString(),
          sessionDurationMs: sessionDuration,
          messageCount: state?.messageCount || 0
        });

        // Don't reconnect on normal closure
        if (code === 1000) {
          resolve(true);
        } else if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 5000);
          setTimeout(connect, backoffMs);
        } else {
          resolve(false);
        }
      });
    };

    connect();
  });
}

// Health check endpoint for Docker
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activeCalls: callStates.size,
    greetedCalls: greetedCalls.size,
    activeFunctionHandlers: activeFunctionHandlers.size
  });
});

// Cache refresh endpoint (consider adding authentication in production)
app.post("/admin/refresh-cache", (req, res) => {
  logEvent('info', 'admin', null, 'Cache refresh requested', {
    sourceIp: req.ip
  });

  try {
    clearCache();
    res.status(200).json({
      status: "success",
      message: "Cache cleared successfully",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logEvent('error', 'admin', null, 'Cache refresh failed', {
      error: error.message
    });
    res.status(500).json({
      status: "error",
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post("/openai-webhook", async (req, res) => {
  if (!verifySignature(req)) {
    logEvent('error', 'webhook', null, 'Webhook rejected - invalid signature', {
      sourceIp: req.ip
    });
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

  // Cleanup events - remove call from greeted set and call states
  const cleanupEvents = [
    "realtime.call.ended",
    "realtime.call.failed",
    "realtime.call.disconnected",
    "realtime.call.participant.disconnected"
  ];

  if (cleanupEvents.includes(type)) {
    const { call_id } = data;

    // Get call state before cleanup
    const state = callStates.get(call_id);
    const callDuration = state ? Date.now() - state.started : 0;

    logEvent('info', 'cleanup', call_id, `Cleaning up call (${type})`, {
      eventType: type,
      callDurationMs: callDuration,
      messageCount: state?.messageCount || 0,
      wasInterrupted: state?.interrupted || false
    });

    // Clean up all tracking
    greetedCalls.delete(call_id);
    callStates.delete(call_id);

    return res.send("ok");
  }

  if (type.startsWith("realtime.")) {
    logEvent('info', 'webhook', data?.call_id || null, 'Unhandled realtime event', {
      eventType: type,
      payload: data
    });
  } else {
    logEvent('warn', 'webhook', null, 'Non-realtime webhook received', {
      eventType: type,
      payload: req.body
    });
  }

  res.send("ok");
});

// Graceful shutdown handler
function gracefulShutdown(signal) {
  logEvent('info', 'shutdown', null, `Received ${signal}, starting graceful shutdown`);

  // Stop accepting new connections
  server.close(() => {
    logEvent('info', 'shutdown', null, 'HTTP server closed');

    // Clean up call state
    logEvent('info', 'shutdown', null, 'Cleaning up call state', {
      activeCalls: callStates.size,
      greetedCalls: greetedCalls.size,
      activeFunctionHandlers: activeFunctionHandlers.size
    });

    greetedCalls.clear();
    activeFunctionHandlers.clear();
    callStates.clear();

    logEvent('info', 'shutdown', null, 'Shutdown complete');
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logEvent('error', 'shutdown', null, 'Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const server = app.listen(PORT, () => {
  logEvent('info', 'startup', null, 'Server started', { port: PORT });
});
