# OpenAI Realtime API Phone Assistant

An AI-powered phone assistant that uses OpenAI's Realtime API to handle incoming calls with natural voice conversations, intelligent call routing, and seamless call transfers.

## 📋 Overview

This project creates a virtual phone receptionist that can:
- Answer incoming phone calls with personalized greetings
- Engage in natural voice conversations using OpenAI's GPT-4 Realtime model
- Transfer calls to team members or departments (in progress)
- Provide business information and answer customer questions
- Recognize VIP callers and provide premium service

The system integrates Twilio for phone connectivity with OpenAI's Realtime API for AI-powered voice interactions.

## 🏗️ Architecture & Data Flow

```
┌─────────────┐
│   Caller    │
└──────┬──────┘
       │ Makes call
       ↓
┌─────────────────────┐
│   Twilio Account    │
│   (Free Tier OK)    │
└──────┬──────────────┘
       │ SIP Trunk configured
       │ Routes to OpenAI
       ↓
┌──────────────────────────┐
│  OpenAI Realtime API     │
│  - Manages call session  │
│  - Voice recognition     │
│  - AI conversation       │
│  - TTS (Text-to-Speech)  │
└──────┬───────────────────┘
       │ Sends webhooks
       ↓
┌─────────────────────────────┐
│   Cloudflare Tunnel         │
│   (Public HTTPS endpoint)   │
│(cloudfare / public endpoint)│
└──────┬──────────────────────┘
       │ Forwards to local
       ↓
┌────────────────────────────┐
│   Your Server (NAS)        │
│   - Node.js application    │
│   - Webhook handler        │
│   - Business logic         │
│   - Call transfer logic    │
└────────────────────────────┘
```

**Call Transfer Flow:**
```
Caller → AI detects transfer request
       ↓
AI calls transfer_call("John")
       ↓
Server looks up "John" → +13098258257
       ↓
OpenAI Refer API executes SIP REFER
       ↓
Call transferred to John's phone
```

## 🔧 Requirements

### 1. Twilio Account (Free Tier Works!)

**Setup Steps:**
1. Create Twilio a free account [https://www.twilio.com/try-twilio](https://www.twilio.com/try-twilio)
   - Comes with $15.00 credit
2. Buy a phone number (Twilio Console → Phone Numbers → Buy a Number)
3. Create SIP Domain:
   - Go to: Elastic SIP Trunking → SIP Domains → Create new SIP Domain
   - Name it (e.g., "apexaisolutions.pstn.ashburn.twilio.com")
   - Under "Access Control", create an ACL to allow incoming traffic from OpenAI
   - Add IP addresses to ACL to allow OpenAI's infrastructure
4. Create SIP Trunk:
   - Go to: Elastic SIP Trunking → Trunks → Create new SIP Trunk
   - Name it (e.g., "OpenAI Realtime")
   - Under "Origination", add your OpenAI SIP URI: `sip:proj_YOUR_PROJECT_ID@sip.api.openai.com`
   - Under "Transfer Settings", **enable "Enable PSTN transfers"** (CRITICAL for call transfers)
5. Link your phone number to the SIP Trunk:
   - Phone Numbers → Manage → Active Numbers
   - Select your number
   - Under "Voice & Fax", configure to use your SIP Trunk

### 2. OpenAI Account

**What you need:**
- OpenAI account with API access: [https://platform.openai.com](https://platform.openai.com)
- API key (starts with `sk-proj-`)
- Realtime API enabled (GPT-4 Realtime Preview)
- Webhook configured (Points to where the node.js code is located. Must be public)

**Setup Steps:**
1. Create OpenAI account and add payment method
2. Create API key: Settings → API Keys → Create new secret key
3. Configure webhook:
   - Go to: Settings → Your Project → Webhooks
   - Add endpoint URL: You can use cloudflare tunnels / ngrok / or your own endpoint
   - Copy the webhook signing secret (starts with `whsec_`)

### 3. Public HTTPS Endpoint

**Why?** OpenAI webhooks require a publicly accessible HTTPS URL to send call events.

**Options:**
- **Cloudflare Tunnel** (Recommended - Free) ✅
- **Ngrok** (Free tier available)
- **Port forwarding + SSL certificate** (Advanced)

**Cloudflare Tunnel Setup:**
```bash
# Already configured in docker-compose.yml
docker-compose up -d

# Get your public URL from logs
docker-compose logs cloudflared | grep trycloudflare.com
```

### 4. Server/Hosting

**Options:**
- Home NAS (Synology, QNAP, TrueNAS)
- VPS (DigitalOcean, AWS, etc.)
- Local development machine
- Raspberry Pi

**Requirements:**
- Docker and Docker Compose installed
- Node.js 18+ (if running without Docker)
- Stable internet connection
- 512MB RAM minimum

## 🚀 Quick Start

### Step 1: Clone and Configure

```bash
# Clone the repository
git clone <your-repo-url>
cd realtime-api

# Copy environment template
cp .env.example .env

# Edit with your credentials
nano .env
```

**Required environment variables:**
```bash
OPENAI_API_KEY=sk-proj-your-key-here
OPENAI_WEBHOOK_SECRET=whsec_your-secret-here
PORT=9000
```

### Step 2: Deploy with Docker

```bash
# Start both API and Cloudflare Tunnel
docker-compose up -d

# View logs
docker-compose logs -f

# Find your public URL
docker-compose logs cloudflared | grep trycloudflare.com
```

### Step 3: Configure OpenAI Webhook

1. Copy your public URL from the logs (e.g., `https://quiet-forest-1234.trycloudflare.com`)
2. Go to OpenAI Platform → Settings → Webhooks
3. Update webhook URL: `https://your-url.trycloudflare.com/openai-webhook`
4. Save changes

### Step 4: Test!

Call your Twilio phone number and experience the AI assistant!

What can you ask:
- "Tell me about company X"
- "What are your hours"
- "etc...." Its up to you to provide a knowledge base of data.

## 📞 Call Transfer Feature

The AI can intelligently transfer calls to team members or departments using SIP REFER protocol.

### How It Works

When a caller says:
- "Can I speak to John?"
- "Transfer me to sales"
- "I need technical support"

The AI will:
1. Confirm the transfer
2. Say: "Let me transfer you to [person]. Please hold for a moment."
3. Execute the transfer using OpenAI's Refer API (SIP REFER)
4. Route the call through Twilio's SIP infrastructure to the destination

### Critical Twilio Configuration

**IMPORTANT:** Call transfers will fail with "SIP transfer is disabled" (Error 32218) unless properly configured.

#### Step 1: Create SIP Domain
1. Go to Twilio Console → Elastic SIP Trunking → SIP Domains
2. Create a new SIP Domain (e.g., `apexaisolutions.pstn.ashburn.twilio.com`)
3. Under "Access Control":
   - Create a new IP Access Control List (ACL)
   - Name it (e.g., "OpenAI Realtime API")
   - Add IP ranges to allow OpenAI's infrastructure to reach your domain

#### Step 2: Enable Transfers on SIP Trunk
1. Go to Twilio Console → Elastic SIP Trunking → Trunks
2. Select your trunk connected to OpenAI
3. Scroll to "Transfer Settings"
4. **Enable "Enable PSTN transfers"** ✅ (This is critical!)
5. Save changes

Without this setting enabled, all transfer attempts will result in:
```
Error 32218: SIP transfer is disabled
```

#### Step 3: Configure Transfer Numbers

Edit `config/transfer-numbers.json`:

```json
{
  "sales": {
    "name": "Sales Team",
    "number": "+1309xxxxxxx",
    "description": "For pricing, quotes, and new customer inquiries"
  },
  "john": {
    "name": "John Doe",
    "number": "+1309xxxxxxx",
    "description": "Founder - for strategic discussions"
  }
}
```

The system automatically converts phone numbers to Twilio SIP URIs:
```
+13098258257 → sip:+13098258257@apexaisolutions.pstn.ashburn.twilio.com
```

**Add new destinations:**
```bash
# Edit config
nano config/transfer-numbers.json

# Restart to apply
docker-compose restart
```

No code changes needed!

## 🛠️ Important Code Sections

### 1. Webhook Handler ([server.js](server.js:308))

**Location:** `server.js:308-346`

The core webhook endpoint that receives events from OpenAI:

```javascript
app.post("/openai-webhook", async (req, res) => {
  // Verify signature for security
  if (!verifySignature(req)) {
    return res.status(401).send("invalid signature");
  }

  const { type, data } = req.body;

  // Handle incoming calls
  if (type === "realtime.call.incoming") {
    return await handleIncomingCall(data, res);
  }

  // Additional event handling...
});
```

**What it does:**
- Validates webhook signatures to prevent unauthorized access
- Routes different event types (incoming calls, disconnections, etc.)
- Triggers appropriate handlers for each event

### 2. Call Acceptance Logic ([server.js](server.js:89))

**Location:** `server.js:89-126`

Accepts incoming calls and configures the AI assistant:

```javascript
async function acceptCall(callId, instructions, retries = 3) {
  const response = await fetch(
    `https://api.openai.com/v1/realtime/calls/${callId}/accept`,
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
        audio: { output: { voice: VOICE } },
        tools: [getTransferTool()]  // Enable call transfers
      }),
    }
  );
}
```

**Key features:**
- Retry logic for race conditions (call not ready yet)
- Dynamic instructions based on caller
- Configures voice model and tools

### 3. Dynamic Instruction Builder ([lib/instructionBuilder.js](lib/instructionBuilder.js:7))

**Location:** `lib/instructionBuilder.js:7-58`

Builds personalized AI instructions for each call:

```javascript
export async function buildInstructions(callerPhone) {
  const [systemPrompt, businessKnowledge, contact, transferNumbers] =
    await Promise.all([
      getSystemPrompt(),
      getBusinessKnowledge(),
      getContact(callerPhone),
      getAllTransferNumbers()
    ]);

  // Combines: base prompt + business info + caller data + transfer options
  let instructions = systemPrompt;

  // Add transfer capabilities
  if (Object.keys(transferNumbers).length > 0) {
    instructions += '\n\n## Call Transfer Capability\n';
    // ... adds transfer instructions
  }

  // Personalize for VIP callers
  if (contact?.vip) {
    instructions += `- VIP Client: Yes - provide premium service\n`;
  }

  return instructions;
}
```

**Why this matters:**
- Personalizes greetings for known callers
- Provides VIP treatment for important clients
- Dynamically adds transfer options
- Loads business-specific knowledge

### 4. Call Transfer Implementation ([lib/callTransfer.js](lib/callTransfer.js:10))

**Location:** `lib/callTransfer.js:10-59`

Executes call transfers using OpenAI's Refer API:

```javascript
export async function transferCall(callId, transferKey) {
  // Look up transfer destination from config
  const transferInfo = await getTransferNumber(transferKey);

  // Convert to Twilio SIP URI format for proper routing
  const targetUri = `sip:${transferInfo.number}@apexaisolutions.pstn.ashburn.twilio.com`;

  // Use OpenAI Refer API (SIP REFER)
  const response = await fetch(
    `https://api.openai.com/v1/realtime/calls/${callId}/refer`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ target_uri: targetUri })
    }
  );

  return {
    success: true,
    message: `Call transferred to ${transferInfo.name}`
  };
}
```

**How it works:**
- Looks up phone number from `config/transfer-numbers.json`
- Converts to Twilio SIP URI: `sip:+1234567890@your-domain.pstn.ashburn.twilio.com`
- Uses OpenAI's `/refer` endpoint (executes SIP REFER protocol)
- Twilio routes the call through PSTN to destination number
- Handles errors gracefully with detailed logging
- Logs all transfer attempts with request IDs

### 5. Function Call Handler ([server.js](server.js:248))

**Location:** `server.js:248-301`

Listens for AI function calls via WebSocket:

```javascript
async function handleFunctionCalls(callId) {
  const ws = new WebSocket(
    `wss://api.openai.com/v1/realtime?call_id=${callId}`,
    { headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` } }
  );

  ws.on("message", async (data) => {
    const event = JSON.parse(data.toString());

    // When AI decides to transfer the call
    if (event.type === "response.function_call_arguments.done") {
      const { name, arguments: argsJson } = event;

      if (name === "transfer_call") {
        const args = JSON.parse(argsJson);
        const result = await transferCall(callId, args.destination);

        // Send result back to AI
        ws.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: functionCallId,
            output: JSON.stringify(result)
          }
        }));
      }
    }
  });
}
```

**Why WebSocket?**
- Real-time bidirectional communication with OpenAI
- Receives function call requests from AI
- Sends function results back to AI
- Maintains persistent connection during call

### 6. Signature Verification ([server.js](server.js:30))

**Location:** `server.js:30-66`

Secures webhooks with HMAC signature validation:

```javascript
function verifySignature(req) {
  const webhookId = req.get("webhook-id");
  const timestamp = req.get("webhook-timestamp");
  const signatureHeader = req.get("webhook-signature");

  // Build payload to verify
  const payload = `${webhookId}.${timestamp}.${req.rawBody}`;

  // Decode webhook secret (base64)
  const secretString = process.env.OPENAI_WEBHOOK_SECRET?.replace(/^whsec_/, '');
  const secret = Buffer.from(secretString, 'base64');

  // Compute expected signature
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64");

  // Verify signature matches
  return signatureHeader.includes(expected);
}
```

**Security:**
- Prevents unauthorized webhook calls
- Uses HMAC-SHA256 signature
- Follows OpenAI's webhook security standard
- Protects against replay attacks

## 📁 Project Structure

```
realtime-api/
├── server.js                 # Main application entry point
├── lib/
│   ├── callTransfer.js      # Call transfer logic
│   ├── instructionBuilder.js # Dynamic AI instructions
│   └── dataAccess.js        # Config file readers
├── config/
│   ├── transfer-numbers.json # Transfer destinations
│   ├── contacts.json        # Caller database (optional)
│   ├── business-info.md     # Business knowledge for AI
│   └── system-prompt.txt    # Base AI instructions
├── docker-compose.yml       # Docker orchestration
├── Dockerfile               # Container definition
├── .env                     # Environment variables (create this!)
└── package.json             # Node.js dependencies
```

## 🔐 Security

- ✅ Webhook signature verification (HMAC-SHA256)
- ✅ Environment variables for secrets (never committed)
- ✅ HTTPS enforced via Cloudflare Tunnel
- ✅ Whitelisted transfer numbers (no arbitrary transfers)
- ✅ Docker isolation
- ✅ Read-only config volume mounts

## 📊 Monitoring & Logs

### View Logs
```bash
# All logs
docker-compose logs -f

# API logs only
docker-compose logs -f realtime-api

# Tunnel logs only
docker-compose logs -f cloudflared

# Filter for transfers
docker-compose logs -f | grep transfer
```

### Health Check
```bash
# Local
curl http://localhost:9000/health

# Public
curl https://your-tunnel-url.trycloudflare.com/health
```

### Common Log Patterns
```bash
[incoming] call=rtc_abc123        # New call received
[greeting] triggering for call=   # Greeting being sent
[function] Function call: transfer_call  # Transfer initiated
[transfer] Successfully initiated # Transfer completed
```

## 🐛 Troubleshooting

See detailed troubleshooting guides:
- [Docker Issues](DOCKER_TROUBLESHOOTING.md)
- [Cloudflare Tunnel Setup](CLOUDFLARE_TUNNEL.md)
- [Environment Variables](ENV_SETUP.md)
- [Call Transfer Problems](CALL_TRANSFER.md)

### Quick Fixes

**Calls not connecting:**
```bash
# Check webhook URL is correct in OpenAI dashboard
# Verify tunnel is running
docker ps | grep cloudflare

# Test webhook endpoint
curl https://your-url.trycloudflare.com/health
```

**Transfers not working:**

Common issues and solutions:

1. **Error 32218: "SIP transfer is disabled"**
   - Go to Twilio Console → Elastic SIP Trunking → Trunks
   - Select your trunk → Transfer Settings
   - Enable "Enable PSTN transfers" ✅
   - Save changes (no code restart needed)

2. **500 Internal Server Error on transfer**
   - Verify your SIP domain is correct in `lib/callTransfer.js`
   - Should match: `sip:+1234567890@your-domain.pstn.ashburn.twilio.com`
   - Rebuild after code changes: `docker-compose up -d --build`

3. **Call disconnects immediately on transfer**
   - Check Twilio SIP Domain ACL allows OpenAI IPs
   - Verify transfer number format in config (must start with +)

```bash
# Check transfer config
cat config/transfer-numbers.json

# View transfer logs
docker-compose logs -f | grep transfer

# Test transfer with verbose logging
VERBOSE_LOGGING=true docker-compose up -d

# Restart after config changes
docker-compose restart
```

**Container won't start:**
```bash
# Check logs for errors
docker-compose logs

# Verify .env file exists
ls -la .env

# Rebuild from scratch
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## 🔄 Updating

### Update Configuration (No Rebuild)
```bash
# Edit configs
nano config/transfer-numbers.json
nano config/business-info.md

# Restart to reload
docker-compose restart
```

### Update Code (Requires Rebuild)
```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose up -d --build
```

## 📚 Additional Documentation

- [CALL_TRANSFER.md](CALL_TRANSFER.md) - Detailed call transfer guide
- [DEPLOYMENT.md](DEPLOYMENT.md) - Docker deployment instructions
- [CLOUDFLARE_TUNNEL.md](CLOUDFLARE_TUNNEL.md) - Cloudflare Tunnel setup
- [DOCKER_TROUBLESHOOTING.md](DOCKER_TROUBLESHOOTING.md) - Docker issues
- [ENV_SETUP.md](ENV_SETUP.md) - Environment variable guide

## 🎯 Use Cases

### Customer Service Automation
- 24/7 phone answering
- FAQ handling
- Intelligent routing to departments
- VIP customer recognition

### Small Business Receptionist
- Professional phone presence
- After-hours support
- Call screening and routing
- Message taking

### Sales & Lead Qualification
- Initial inquiry handling
- Qualification questions
- Appointment scheduling
- Transfer to sales team

## 🚀 Future Enhancements

Possible additions:
- [ ] Business hours checking (don't transfer after hours)
- [ ] Voicemail capture and transcription
- [ ] CRM integration (Salesforce, HubSpot)
- [ ] Call analytics and reporting
- [ ] Multi-language support
- [ ] SMS follow-up after calls
- [ ] Calendar integration for scheduling
- [ ] Sentiment analysis

## 📝 License

[Your License Here]

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a pull request.

## 💬 Support

For issues or questions:
1. Check the troubleshooting guides
2. Review logs: `docker-compose logs -f`
3. Open a GitHub issue

---

**Built with:**
- [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime)
- [Twilio](https://www.twilio.com/)
- [Node.js](https://nodejs.org/)
- [Docker](https://www.docker.com/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
