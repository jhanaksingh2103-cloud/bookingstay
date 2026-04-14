/**
 * Ready-to-use Google Apps Script for StayBook.
 *
 * IMPORTANT:
 * - Do NOT use localhost.
 * - Set BOOKING_ID to the booking id from StayBook detail popup webhook URL.
 */

const HOST_EMAIL = 'jhanaksingh2103@gmail.com';
const BOOKING_ID = '616f1082-9e96-45b5-a5f8-5c9dc3a4bb30';
const WEBHOOK_URL = `https://bookingstay.onrender.com/api/submit-form/${BOOKING_ID}`;

function onFormSubmit(e) {
  const named = (e && e.namedValues) || {};
  const values = (e && e.values) || [];

  // Flatten Google namedValues arrays to plain strings
  const payload = {};
  Object.keys(named).forEach((k) => {
    payload[k] = firstValue(named[k]);
  });

  // Aliases StayBook can read reliably
  payload.guest_name = firstValue(named['Guest Name']) || firstValue(named['Name']) || payload.guest_name || '';
  payload.guest_phone = firstValue(named['Phone']) || firstValue(named['Mobile']) || payload.guest_phone || '';
  payload.guest_email = firstValue(named['Email']) || payload.guest_email || '';
  payload.photo_of_members = firstValue(named['Photo of members']) || firstValue(named['photo of members']) || payload.photo_of_members || '';
  payload.id_of_members = firstValue(named['ID of members']) || firstValue(named['id of members']) || payload.id_of_members || '';
  payload.host_email = HOST_EMAIL;
  payload._submitted_at = new Date().toISOString();
  payload._raw_values = values;

  const response = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log('StayBook webhook status: %s', response.getResponseCode());
  Logger.log('StayBook webhook body: %s', response.getContentText());
}

function firstValue(v) {
  if (Array.isArray(v)) return String(v[0] || '').trim();
  return String(v || '').trim();
}
