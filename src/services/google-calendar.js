/**
 * Google Calendar Integration Service
 *
 * Uses a Google Service Account to sync schedule events to Google Calendar.
 *
 * Setup:
 * 1. Go to Google Cloud Console → Create project (or use existing)
 * 2. Enable "Google Calendar API"
 * 3. Create Service Account → Download JSON key
 * 4. Save the JSON key file as google-credentials.json in project root
 * 5. Share your Google Calendar with the service account email (xxx@xxx.iam.gserviceaccount.com)
 *    with "Make changes to events" permission
 * 6. Set GOOGLE_CALENDAR_ID in .env (looks like: abcdef@group.calendar.google.com)
 * 7. Set GOOGLE_CALENDAR_ENABLED=true in .env
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { queryOne } = require('../db/pool');

let calendarClient = null;
let isEnabled = null;
let calendarId = null;

/**
 * Initialize Google Calendar client using service account credentials
 */
function getCalendarClient() {
  if (calendarClient) return calendarClient;

  const credentialsPath = path.join(__dirname, '..', '..', 'google-credentials.json');

  if (!fs.existsSync(credentialsPath)) {
    console.warn('[GCal] google-credentials.json not found — Google Calendar sync disabled');
    return null;
  }

  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    calendarClient = google.calendar({ version: 'v3', auth });
    console.log('[GCal] Google Calendar client initialized');
    return calendarClient;
  } catch (err) {
    console.error('[GCal] Failed to initialize:', err.message);
    return null;
  }
}

/**
 * Check if Google Calendar sync is enabled (from DB settings + env)
 */
async function isGCalEnabled() {
  // Check env first (fast path)
  if (process.env.GOOGLE_CALENDAR_ENABLED === 'true') {
    await loadCalendarId();
    return !!calendarId;
  }

  // Check DB settings
  try {
    const setting = await queryOne("SELECT value FROM settings WHERE key = 'google_calendar_enabled'");
    if (setting?.value === 'true') {
      await loadCalendarId();
      return !!calendarId;
    }
  } catch (err) {
    // Settings table might not exist yet
  }

  return false;
}

/**
 * Get the target Google Calendar ID
 */
function getCalendarId() {
  if (calendarId) return calendarId;

  // From env
  if (process.env.GOOGLE_CALENDAR_ID) {
    calendarId = process.env.GOOGLE_CALENDAR_ID;
    return calendarId;
  }

  return null;
}

/**
 * Load calendar ID from DB (async, called on first use)
 */
async function loadCalendarId() {
  if (calendarId) return calendarId;

  if (process.env.GOOGLE_CALENDAR_ID) {
    calendarId = process.env.GOOGLE_CALENDAR_ID;
    return calendarId;
  }

  try {
    const setting = await queryOne("SELECT value FROM settings WHERE key = 'google_calendar_id'");
    if (setting?.value) {
      calendarId = setting.value;
      return calendarId;
    }
  } catch (err) {
    // ignore
  }

  return null;
}

/**
 * Add 1 hour to a local time string "YYYY-MM-DDTHH:MM:SS"
 */
function addHour(timeStr) {
  const d = new Date(timeStr + '+03:00'); // treat as Sofia time
  d.setHours(d.getHours() + 1);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Convert platform event to Google Calendar event format
 */
function toGCalEvent(event, attendeeEmails = []) {
  const gcalEvent = {
    summary: event.title,
    description: event.description || '',
  };

  // Google Calendar event color (colorId: '10' = Basil/green, '2' = Sage, '11' = Tomato, etc.)
  if (event.colorId) gcalEvent.colorId = event.colorId;

  if (event.all_day) {
    // All-day event: use date (not dateTime)
    const startDate = new Date(event.starts_at).toISOString().split('T')[0];
    gcalEvent.start = { date: startDate };

    if (event.ends_at) {
      // Google Calendar all-day end date is exclusive (add 1 day)
      const endDate = new Date(event.ends_at);
      endDate.setDate(endDate.getDate() + 1);
      gcalEvent.end = { date: endDate.toISOString().split('T')[0] };
    } else {
      // Single day event — end = start + 1 day
      const endDate = new Date(event.starts_at);
      endDate.setDate(endDate.getDate() + 1);
      gcalEvent.end = { date: endDate.toISOString().split('T')[0] };
    }
  } else {
    // Timed event — pass local time string directly with timeZone
    // (NOT .toISOString() which converts to UTC and causes +3h offset)
    const startStr = event.starts_at.includes('+') || event.starts_at.endsWith('Z')
      ? event.starts_at
      : event.starts_at; // already local time like "2026-04-07T10:00:00"
    const endStr = event.ends_at
      ? (event.ends_at.includes('+') || event.ends_at.endsWith('Z') ? event.ends_at : event.ends_at)
      : null;

    gcalEvent.start = {
      dateTime: startStr,
      timeZone: 'Europe/Sofia',
    };
    gcalEvent.end = {
      dateTime: endStr || addHour(startStr),
      timeZone: 'Europe/Sofia',
    };
  }

  // Add attendees if emails provided
  if (attendeeEmails.length > 0) {
    gcalEvent.attendees = attendeeEmails.map(email => ({ email }));
  }

  return gcalEvent;
}

/**
 * Create event in Google Calendar
 * @returns {string|null} Google Calendar event ID
 */
async function createGCalEvent(event, attendeeEmails = []) {
  try {
    const enabled = await isGCalEnabled();
    if (!enabled) return null;

    const calendar = getCalendarClient();
    if (!calendar) return null;

    await loadCalendarId();
    if (!calendarId) {
      console.warn('[GCal] No calendar ID configured');
      return null;
    }

    const gcalEvent = toGCalEvent(event, attendeeEmails);

    const response = await calendar.events.insert({
      calendarId: calendarId,
      requestBody: gcalEvent,
      sendUpdates: 'none', // Don't spam attendees with emails
    });

    console.log(`[GCal] Created event: ${response.data.id} for "${event.title}"`);
    return response.data.id;
  } catch (err) {
    console.error('[GCal] Create event error:', err.message);
    return null;
  }
}

/**
 * Update event in Google Calendar
 */
async function updateGCalEvent(googleEventId, event, attendeeEmails = []) {
  try {
    if (!googleEventId) return false;

    const enabled = await isGCalEnabled();
    if (!enabled) return false;

    const calendar = getCalendarClient();
    if (!calendar) return false;

    await loadCalendarId();
    if (!calendarId) return false;

    const gcalEvent = toGCalEvent(event, attendeeEmails);

    await calendar.events.update({
      calendarId: calendarId,
      eventId: googleEventId,
      requestBody: gcalEvent,
      sendUpdates: 'none',
    });

    console.log(`[GCal] Updated event: ${googleEventId} — "${event.title}"`);
    return true;
  } catch (err) {
    console.error('[GCal] Update event error:', err.message);
    return false;
  }
}

/**
 * Delete event from Google Calendar
 */
async function deleteGCalEvent(googleEventId) {
  try {
    if (!googleEventId) return false;

    const enabled = await isGCalEnabled();
    if (!enabled) return false;

    const calendar = getCalendarClient();
    if (!calendar) return false;

    await loadCalendarId();
    if (!calendarId) return false;

    await calendar.events.delete({
      calendarId: calendarId,
      eventId: googleEventId,
      sendUpdates: 'none',
    });

    console.log(`[GCal] Deleted event: ${googleEventId}`);
    return true;
  } catch (err) {
    // 404 = already deleted, that's fine
    if (err.code === 404) {
      console.log(`[GCal] Event already deleted: ${googleEventId}`);
      return true;
    }
    console.error('[GCal] Delete event error:', err.message);
    return false;
  }
}

/**
 * Reset cached values (for when admin updates settings)
 */
function resetCache() {
  calendarClient = null;
  isEnabled = null;
  calendarId = null;
}

module.exports = {
  createGCalEvent,
  updateGCalEvent,
  deleteGCalEvent,
  isGCalEnabled,
  resetCache,
};
