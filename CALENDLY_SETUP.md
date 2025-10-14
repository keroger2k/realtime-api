# Calendly Phone Scheduling Integration

This guide shows you how to enable phone-based Calendly meeting scheduling with your AI assistant.

## 🎯 What This Does

Callers can schedule Calendly meetings **directly over the phone** by talking to your AI assistant:

**Example conversation:**
```
Caller: "I'd like to schedule a consultation"
AI: "I'd be happy to help you schedule that! May I have your full name?"
Caller: "John Smith"
AI: "Great, and what's the best email address for your confirmation?"
Caller: "john@example.com"
AI: "When would you like to meet?"
Caller: "Tomorrow afternoon around 2 PM"
AI: "Perfect! I've scheduled your consultation for Tuesday, January 15th at 2:00 PM.
     You'll receive a confirmation email at john@example.com with all the details."
```

---

## 📋 Setup Steps

### 1. Get Your Calendly API Credentials

#### a) Create a Personal Access Token

1. Log into your Calendly account
2. Go to **Integrations & Apps**: https://calendly.com/integrations
3. Click **API & Webhooks** → **Personal Access Tokens**
4. Click **+ Generate New Token**
5. Give it a name (e.g., "Phone Assistant")
6. Click **Create Token**
7. **Copy the token** (starts with `eyJraWQ...`) - you won't see it again!

#### b) Get Your User URI

1. Go to the Calendly API docs: https://calendly.com/api/v2/docs
2. Click the **"Try it" tab** on any endpoint
3. In the authorization popup, paste your token
4. Make a test request to `/users/me`
5. Copy the `uri` field from the response
   - It looks like: `https://api.calendly.com/users/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`

**Or use this curl command:**
```bash
curl https://api.calendly.com/users/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### 2. Add Credentials to `.env` File

Edit your `.env` file and add:

```bash
# Calendly Integration
CALENDLY_API_KEY=eyJraWQiOiIxY2UxZ...your-actual-token-here
CALENDLY_USER_URI=https://api.calendly.com/users/12345678-1234-1234-1234-123456789abc
```

### 3. Configure Your Calendly Event Types

Make sure you have at least one event type set up in Calendly:

1. Go to https://calendly.com/event_types
2. Create event types like:
   - "Consultation" (30 min)
   - "Demo" (45 min)
   - "Follow-up Call" (15 min)
3. Set your availability for each

The AI will automatically match caller requests to your event types!

### 4. Rebuild and Test

```bash
# Rebuild the Docker container
docker-compose up -d --build

# Watch the logs
docker-compose logs -f
```

### 5. Test the Integration

Call your AI assistant and say:
- "I'd like to schedule a meeting"
- "Can I book an appointment?"
- "When can we meet?"

The AI will guide the caller through scheduling!

---

## 🎤 How It Works

### Conversation Flow

1. **Caller expresses interest** in scheduling
2. **AI gathers information**:
   - Full name
   - Email address
   - Preferred date/time (natural language)
   - Meeting type (optional)
3. **System checks availability** via Calendly API
4. **Books the first available slot** matching their request
5. **Confirms to caller** with meeting details
6. **Calendly sends** confirmation email automatically

### Natural Language Time Parsing

The AI understands phrases like:
- "Tomorrow at 2pm"
- "Next Monday morning"
- "This Friday afternoon"
- "Next week"
- "In two days"

### Smart Matching

The system automatically:
- Matches meeting types (e.g., "consultation" → "Initial Consultation" event)
- Finds available slots within the requested timeframe
- Falls back to first available event type if no match found

---

## 📊 Monitoring Calendly Scheduling

View scheduling activity in your logs:

```bash
# All Calendly events
docker-compose logs -f | grep '"category":"calendly"'

# Successful bookings
docker-compose logs -f | grep '"category":"calendly"' | grep '"success":true'

# Failed attempts
docker-compose logs -f | grep '"category":"calendly"' | grep '"success":false'
```

### Example Log Entry

```json
{
  "timestamp": "2025-01-14T12:34:56.789Z",
  "level": "info",
  "category": "calendly",
  "callId": "rtc_abc123",
  "message": "Calendly scheduling completed",
  "name": "John Smith",
  "email": "john@example.com",
  "success": true,
  "durationMs": 2341
}
```

---

## 🔧 Advanced Configuration

### Customizing Meeting Types

Edit `lib/calendlyIntegration.js` to customize how meeting types are matched:

```javascript
// Current: Simple name matching
const eventType = eventTypes.find(et =>
  et.name.toLowerCase().includes(meetingType.toLowerCase())
) || eventTypes[0];

// Advanced: Priority matching
const eventType = findBestMatch(meetingType, eventTypes);
```

### Handling Multiple Calendars

If you have multiple Calendly accounts or calendars, you can extend the system to route to different calendars based on:
- Meeting type
- Caller VIP status
- Business hours
- Team member availability

### Adding Confirmation SMS

Integrate Twilio SMS to send additional confirmations:

```javascript
// After successful booking
await sendSMS(callerPhone,
  `Meeting confirmed for ${dateStr}. Check ${email} for details.`
);
```

---

## 🚨 Troubleshooting

### "I'm having trouble accessing the calendar"

**Cause:** API credentials are missing or invalid

**Fix:**
1. Verify `CALENDLY_API_KEY` is set correctly in `.env`
2. Verify `CALENDLY_USER_URI` is set correctly
3. Test your token with curl:
   ```bash
   curl https://api.calendly.com/users/me \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```
4. Rebuild: `docker-compose up -d --build`

### "No available slots"

**Cause:** No availability in requested timeframe

**Fix:**
1. Check your Calendly availability settings
2. Ensure event types are active
3. Test with a broader request ("next week" instead of "tomorrow")

### Rate Limiting

Calendly API has rate limits. If you hit them:
- Implement caching for availability checks
- Add exponential backoff for retries
- Consider upgrading your Calendly plan

---

## 💡 Pro Tips

### 1. **VIP Fast-Track Scheduling**
Prioritize VIP callers from your contacts database:

```javascript
if (contact?.vip) {
  // Book immediately without asking for email
  // Use contact email from database
}
```

### 2. **Business Hours Check**
Add validation to prevent after-hours booking:

```javascript
if (isOutsideBusinessHours(preferredTime)) {
  return "I can only book during business hours (9 AM - 5 PM). When works for you?"
}
```

### 3. **Meeting Notes**
Automatically include call context in meeting notes:

```javascript
notes: `Scheduled via phone call. Caller ID: ${callerPhone}.
        Topics discussed: ${callSummary}`
```

### 4. **Multi-Language Support**
While the AI speaks English, you can add translation for email confirmations and calendar invites.

---

## 🎉 What's Next?

Once this is working, consider adding:

- **SMS confirmations** via Twilio
- **Calendar sync** with Google Calendar/Outlook
- **Rescheduling capability** over the phone
- **Meeting reminders** 24 hours before
- **Post-call follow-ups** with meeting summary

---

## 📚 References

- [Calendly API Docs](https://developer.calendly.com/)
- [Calendly API Reference](https://calendly.com/api/v2/docs)
- [Personal Access Tokens](https://calendly.com/integrations/api_webhooks)
- [Rate Limits](https://developer.calendly.com/api-docs/ZG9jOjQ0MTkzNjA-api-conventions#rate-limiting)

---

## 🆘 Support

Having issues? Check:
1. Docker logs: `docker-compose logs -f | grep calendly`
2. API credentials are valid
3. Event types are configured in Calendly
4. Your Calendly plan supports API access

For questions, file an issue or check the main README.
