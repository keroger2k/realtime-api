import fetch from 'node-fetch';

/**
 * Calendly API Integration for Phone Scheduling
 *
 * Required Environment Variables:
 * - CALENDLY_API_KEY: Your Calendly Personal Access Token
 * - CALENDLY_USER_URI: Your Calendly user URI (e.g., https://api.calendly.com/users/XXXXX)
 */

const CALENDLY_API_BASE = 'https://api.calendly.com';
const CALENDLY_API_KEY = process.env.CALENDLY_API_KEY;
const CALENDLY_USER_URI = process.env.CALENDLY_USER_URI;

/**
 * Get available event types (meeting types) from Calendly
 * @returns {Promise<Array>} List of event types
 */
export async function getEventTypes() {
  try {
    const response = await fetch(`${CALENDLY_API_BASE}/event_types?user=${CALENDLY_USER_URI}`, {
      headers: {
        'Authorization': `Bearer ${CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Calendly API error: ${response.status}`);
    }

    const data = await response.json();
    return data.collection.map(event => ({
      name: event.name,
      uri: event.uri,
      duration: event.duration,
      description: event.description_plain || event.description_html
    }));
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'calendly',
      callId: 'system',
      message: 'Failed to fetch event types',
      error: error.message
    }));
    return [];
  }
}

/**
 * Get available time slots for a specific event type
 * @param {string} eventTypeUri - The Calendly event type URI
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @returns {Promise<Array>} Available time slots
 */
export async function getAvailability(eventTypeUri, startDate, endDate) {
  try {
    // Extract event type UUID from URI
    const eventTypeUuid = eventTypeUri.split('/').pop();

    const response = await fetch(
      `${CALENDLY_API_BASE}/event_type_available_times?event_type=${eventTypeUri}&start_time=${startDate}T00:00:00Z&end_time=${endDate}T23:59:59Z`,
      {
        headers: {
          'Authorization': `Bearer ${CALENDLY_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Calendly API error: ${response.status}`);
    }

    const data = await response.json();
    return data.collection || [];
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'calendly',
      callId: 'system',
      message: 'Failed to fetch availability',
      error: error.message,
      eventTypeUri,
      startDate,
      endDate
    }));
    return [];
  }
}

/**
 * Schedule a meeting via Calendly API
 * @param {Object} params - Meeting parameters
 * @param {string} params.eventTypeUri - The event type URI
 * @param {string} params.startTime - ISO datetime string
 * @param {string} params.name - Invitee name
 * @param {string} params.email - Invitee email
 * @param {string} params.notes - Optional meeting notes
 * @returns {Promise<Object>} Scheduling result
 */
export async function scheduleMeeting({ eventTypeUri, startTime, name, email, notes = '' }) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    category: 'calendly',
    callId: 'system',
    message: 'Attempting to schedule meeting',
    eventTypeUri,
    startTime,
    name,
    email
  }));

  try {
    // Create scheduling link first
    const response = await fetch(`${CALENDLY_API_BASE}/scheduling_links`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CALENDLY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        max_event_count: 1,
        owner: CALENDLY_USER_URI,
        owner_type: 'EventType',
        event_type: eventTypeUri
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Calendly scheduling link failed: ${response.status} - ${errorText}`);
    }

    const linkData = await response.json();
    const schedulingUrl = linkData.resource.booking_url;

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      category: 'calendly',
      callId: 'system',
      message: 'Meeting scheduled successfully',
      schedulingUrl,
      name,
      email,
      startTime
    }));

    return {
      success: true,
      message: `Meeting scheduled successfully for ${name}`,
      schedulingUrl,
      startTime,
      email
    };
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'calendly',
      callId: 'system',
      message: 'Failed to schedule meeting',
      error: error.message,
      stack: error.stack,
      eventTypeUri,
      name,
      email
    }));

    return {
      success: false,
      message: `Failed to schedule meeting: ${error.message}`
    };
  }
}

/**
 * Format available slots for AI to present to caller
 * @param {Array} slots - Available time slots
 * @param {number} limit - Maximum number of slots to return
 * @returns {string} Formatted availability message
 */
export function formatAvailableSlots(slots, limit = 5) {
  if (!slots || slots.length === 0) {
    return "I don't have any available slots for those dates. Would you like to try different dates?";
  }

  const limitedSlots = slots.slice(0, limit);
  const formatted = limitedSlots.map((slot, index) => {
    const date = new Date(slot.start_time);
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
    const timeStr = date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `${index + 1}. ${dateStr} at ${timeStr}`;
  }).join(', ');

  return `I have the following times available: ${formatted}. Which would work best for you?`;
}

/**
 * Parse natural language date/time from caller
 * @param {string} naturalTime - e.g., "tomorrow at 2pm", "next Monday", "this Friday afternoon"
 * @returns {Object} Parsed date range
 */
export function parseNaturalTime(naturalTime) {
  const now = new Date();
  let startDate = new Date(now);
  let endDate = new Date(now);

  const lower = naturalTime.toLowerCase();

  // Handle "tomorrow"
  if (lower.includes('tomorrow')) {
    startDate.setDate(now.getDate() + 1);
    endDate.setDate(now.getDate() + 1);
  }
  // Handle "next week"
  else if (lower.includes('next week')) {
    startDate.setDate(now.getDate() + 7);
    endDate.setDate(now.getDate() + 14);
  }
  // Handle "next Monday", "next Tuesday", etc.
  else if (lower.includes('next')) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.findIndex(day => lower.includes(day));
    if (targetDay !== -1) {
      const daysUntilTarget = (targetDay - now.getDay() + 7) % 7 || 7;
      startDate.setDate(now.getDate() + daysUntilTarget);
      endDate = new Date(startDate);
    }
  }
  // Handle "this week"
  else if (lower.includes('this week')) {
    endDate.setDate(now.getDate() + 7);
  }
  // Default: check next 7 days
  else {
    endDate.setDate(now.getDate() + 7);
  }

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0]
  };
}

/**
 * Get the Calendly function tool definition for OpenAI Realtime API
 */
export function getCalendlyTool() {
  return {
    type: "function",
    name: "schedule_calendly_meeting",
    description: "Schedule a Calendly meeting with the caller. Use this when someone wants to book an appointment, schedule a call, or set up a meeting. Gather their name, email, preferred date/time, and meeting type before calling.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The caller's full name"
        },
        email: {
          type: "string",
          description: "The caller's email address"
        },
        meetingType: {
          type: "string",
          description: "Type of meeting (e.g., 'consultation', 'demo', 'follow-up')"
        },
        preferredTime: {
          type: "string",
          description: "Caller's preferred date and time in natural language (e.g., 'tomorrow at 2pm', 'next Monday morning', '2025-10-15T09:00:00')"
        },
        date: {
          type: "string",
          description: "Alternative parameter: ISO date string if exact date/time is provided (e.g., '2025-10-15T09:00:00')"
        },
        notes: {
          type: "string",
          description: "Optional notes about the meeting purpose"
        }
      },
      required: ["name", "email"]
    }
  };
}

/**
 * Handle the schedule_calendly_meeting function call from AI
 * @param {Object} args - Function arguments from AI
 * @returns {Promise<Object>} Scheduling result
 */
export async function handleCalendlyScheduling(args) {
  // Normalize parameter names (support both camelCase and snake_case)
  const name = args.name;
  const email = args.email;
  const meetingType = args.meetingType || args.meeting_type || 'consultation';
  const notes = args.notes || args.meeting_topic || '';
  const preferredTime = args.preferredTime || args.date || args.time_preference || args.preferred_time;

  // Always log the request, even if parameters are missing
  try {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      category: 'calendly',
      callId: 'system',
      message: 'Processing Calendly scheduling request',
      name,
      email,
      meetingType,
      preferredTime,
      allArgs: args
    }));
  } catch (logError) {
    // If even logging fails, use console.error
    console.error('[calendly] Failed to log request:', logError.message, args);
  }

  // Check if Calendly is configured
  if (!CALENDLY_API_KEY || !CALENDLY_USER_URI) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'calendly',
      callId: 'system',
      message: 'Calendly API credentials not configured',
      hasApiKey: !!CALENDLY_API_KEY,
      hasUserUri: !!CALENDLY_USER_URI
    }));
    return {
      success: false,
      message: "I'm unable to access the scheduling system right now. Please visit our website to book an appointment, or I can have someone call you back."
    };
  }

  // Validate required parameters
  if (!preferredTime) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'calendly',
      callId: 'system',
      message: 'Missing preferredTime or date parameter',
      args
    }));
    return {
      success: false,
      message: "I need to know when you'd like to meet. When would be a good time for you?"
    };
  }

  try {
    // Step 1: Get available event types
    const eventTypes = await getEventTypes();
    if (eventTypes.length === 0) {
      return {
        success: false,
        message: "I'm having trouble accessing the calendar right now. Could you try booking at [your-calendly-link]?"
      };
    }

    // Step 2: Find matching event type or use first one
    const eventType = eventTypes.find(et =>
      et.name.toLowerCase().includes(meetingType.toLowerCase())
    ) || eventTypes[0];

    // Step 3: Parse preferred time
    const { startDate, endDate } = parseNaturalTime(preferredTime);

    // Step 4: Check availability
    const availableSlots = await getAvailability(eventType.uri, startDate, endDate);

    if (availableSlots.length === 0) {
      return {
        success: false,
        message: `I don't have any ${eventType.name} slots available for ${preferredTime}. ${formatAvailableSlots(availableSlots)}`
      };
    }

    // Step 5: Book the first available slot (or let AI choose)
    const selectedSlot = availableSlots[0];
    const result = await scheduleMeeting({
      eventTypeUri: eventType.uri,
      startTime: selectedSlot.start_time,
      name,
      email,
      notes
    });

    if (result.success) {
      const meetingDate = new Date(selectedSlot.start_time);
      const dateStr = meetingDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      return {
        success: true,
        message: `Perfect! I've scheduled your ${eventType.name} for ${dateStr}. You'll receive a confirmation email at ${email} with all the details and a calendar invite.`
      };
    }

    return result;
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      category: 'calendly',
      callId: 'system',
      message: 'Calendly scheduling exception',
      error: error.message,
      stack: error.stack
    }));

    return {
      success: false,
      message: "I encountered an error while scheduling. Please try booking directly at our website or I can take your information and have someone call you back."
    };
  }
}
