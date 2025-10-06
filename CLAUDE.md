# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An AI-powered phone assistant using OpenAI's Realtime API to handle incoming calls with natural voice conversations and intelligent call routing. The system integrates Twilio for telephony with OpenAI's GPT-4 Realtime model for voice interactions.

**Tech Stack:** Node.js (ES modules), Express, WebSocket, OpenAI Realtime API, Twilio SIP, Docker

## Development Commands

```bash
# Local development
npm install
npm start

# Docker deployment
docker-compose up -d              # Start all services (API + Cloudflare tunnel)
docker-compose logs -f            # View logs
docker-compose restart            # Restart after config changes
docker-compose down               # Stop services
docker-compose up -d --build      # Rebuild and restart

# Get public tunnel URL
docker-compose logs cloudflared | grep trycloudflare.com

# Health check
curl http://localhost:9000/health
```

## Architecture Overview

### Call Flow Architecture

```
Caller → Twilio (SIP) → OpenAI Realtime API → Webhook → This Server
                                             ↓
                                      WebSocket Connection
                                      (bidirectional events)
```

**Key Components:**

1. **Webhook Handler** (`server.js:308`): Receives events from OpenAI (call incoming, ended, etc.)
2. **WebSocket Connections**: Two separate connections per call:
   - **Greeting WS** (`server.js:128`): Sends initial personalized greeting
   - **Function Call WS** (`server.js:248`): Handles AI function calls (transfers)
3. **Call Acceptance** (`server.js:89`): Accepts call and configures AI with instructions + tools
4. **Dynamic Instruction Builder** (`lib/instructionBuilder.js`): Combines system prompt + business knowledge + caller info + transfer options
5. **Call Transfer System** (`lib/callTransfer.js`): Uses OpenAI Refer API (SIP REFER) for transfers

### Data Flow for Incoming Calls

1. OpenAI sends `realtime.call.incoming` webhook
2. Server extracts caller phone number from SIP headers (`server.js:77`)
3. Builds personalized instructions and greeting (`lib/instructionBuilder.js:7`)
4. Accepts call with instructions and tools (`server.js:89`)
5. Starts function call handler WebSocket (`server.js:227`)
6. Sends personalized greeting via separate WebSocket (`server.js:128`)
7. AI conversation begins

### Call Transfer Flow

1. Caller requests transfer ("Can I speak to John?")
2. AI decides to call `transfer_call` function
3. Function call handler receives `response.function_call_arguments.done` event (`server.js:266`)
4. Server executes transfer via OpenAI Refer API (`lib/callTransfer.js:10`)
5. Result sent back to AI via WebSocket
6. AI confirms transfer to caller

## Configuration System

All configuration lives in `config/` directory (mounted as read-only volume in Docker):

- **`system-prompt.txt`**: Base AI instructions/personality
- **`business-info.md`**: Business-specific knowledge for AI
- **`contacts.json`**: Known caller database with VIP flags
- **`transfer-numbers.json`**: Transfer destinations with keys

**Important:** Config changes require service restart (`docker-compose restart`), but **no rebuild needed** due to volume mount.

### Data Access Layer (`lib/dataAccess.js`)

All config loading is centralized here with in-memory caching. Functions are designed for easy database migration:

```javascript
// Current: File-based
export async function getContact(phoneNumber) {
  const contacts = await loadContacts();
  return contacts[phoneNumber] || null;
}

// Future: Database (just swap implementation)
export async function getContact(phoneNumber) {
  return await db.query('SELECT * FROM contacts WHERE phone = $1', [phoneNumber]);
}
```

## Important Implementation Details

### Webhook Security

**CRITICAL:** Webhook signature verification (`server.js:30`) uses HMAC-SHA256. The webhook secret:
- Starts with `whsec_` prefix
- Is base64-encoded
- Must strip prefix before decoding: `process.env.OPENAI_WEBHOOK_SECRET?.replace(/^whsec_/, '')`

### Race Condition Handling

Call acceptance has retry logic (`server.js:89`) because OpenAI may send webhook before call is fully ready. Retries 3 times with 500ms delay on 404 errors.

### WebSocket State Management

- **`greetedCalls` Set**: Prevents duplicate greetings per call
- **`activeFunctionHandlers` Set**: Prevents duplicate function handlers
- Both cleaned up on call end events

### Function Call Handler Pattern

The function handler WebSocket must:
1. Send `conversation.item.create` with `function_call_output` type
2. Send `response.create` to trigger AI response
3. Stay connected for entire call duration

See `server.js:275-286` for reference implementation.

### Transfer Tool Definition

The `transfer_call` tool uses `enum` parameter (`lib/callTransfer.js:64`) to restrict valid destinations. **When adding new transfer destinations:**

1. Add to `config/transfer-numbers.json`
2. Update `enum` in `getTransferTool()` function
3. Restart service (no rebuild needed for config, but code change requires rebuild)

## Environment Variables

Required:
- `OPENAI_API_KEY`: OpenAI API key (sk-proj-...)
- `OPENAI_WEBHOOK_SECRET`: Webhook signing secret (whsec_...)

Optional (with defaults):
- `PORT=9000`: Server port
- `OPENAI_MODEL=gpt-4o-realtime-preview-2024-12-17`: Realtime model
- `OPENAI_VOICE=shimmer`: Voice model
- `GREETING_DELAY_MS=400`: Delay before greeting
- `VERBOSE_LOGGING=false`: Enable verbose WebSocket logs

## Common Development Tasks

### Adding a New Transfer Destination

1. Edit `config/transfer-numbers.json`:
```json
{
  "newkey": {
    "name": "Person Name",
    "number": "+1234567890",
    "description": "What they handle"
  }
}
```

2. Update `lib/callTransfer.js:74` enum array
3. Rebuild: `docker-compose up -d --build`

### Changing AI Personality

Edit `config/system-prompt.txt`, then restart (no rebuild):
```bash
docker-compose restart
```

### Adding Business Knowledge

Edit `config/business-info.md`, then restart (no rebuild):
```bash
docker-compose restart
```

### Testing Webhooks Locally

1. Start services: `docker-compose up -d`
2. Get tunnel URL: `docker-compose logs cloudflared | grep trycloudflare.com`
3. Configure in OpenAI dashboard: `https://<tunnel-url>/openai-webhook`
4. Test call through Twilio number

## Debugging

### Viewing Logs

```bash
# All logs with filters
docker-compose logs -f | grep incoming    # New calls
docker-compose logs -f | grep function    # Function calls
docker-compose logs -f | grep transfer    # Transfer attempts
docker-compose logs -f | grep greeting    # Greeting events
```

### Common Log Patterns

- `[incoming] call=rtc_abc123 caller=...`: New call received
- `[greeting] triggering for call=...`: Greeting being sent
- `[function] Function call: transfer_call`: AI calling transfer
- `[transfer] Successfully initiated`: Transfer completed

### Troubleshooting Call Issues

1. **Call not connecting**: Check webhook URL in OpenAI dashboard matches tunnel URL
2. **Signature failures**: Verify `OPENAI_WEBHOOK_SECRET` includes `whsec_` prefix
3. **Transfers failing**: Check transfer key exists in config and enum matches
4. **No greeting**: Check `greetedCalls` set cleanup on previous call end

## Known Limitations

- Cloudflare Tunnel URL changes on restart (use static tunnel for production)
- Config caching requires service restart (consider adding cache-clear endpoint)
- Transfer tool enum must be manually synced with config file
- No database integration yet (all data is file-based with in-memory cache)

## Testing Strategy

When making changes:
1. Test basic call flow (incoming → greeting → conversation)
2. Test transfer flow (request transfer → confirm → execute)
3. Test VIP caller personalization
4. Check logs for errors during call lifecycle
5. Verify webhook signature validation with invalid secret
