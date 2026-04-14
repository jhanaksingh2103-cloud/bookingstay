const { execFileSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const FormResponse = require('../models/FormResponse');
const HostSetting = require('../models/HostSetting');

const DB_PATH = path.join(__dirname, '..', 'staybook.db');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/staybook';

function sqliteJson(query) {
  const out = execFileSync('sqlite3', ['-json', DB_PATH, query], { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
}

function toDateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

(async () => {
  await mongoose.connect(MONGO_URI);

  const bookings = sqliteJson('SELECT * FROM bookings;');
  const responses = sqliteJson('SELECT * FROM form_responses;');
  const settings = sqliteJson('SELECT * FROM host_settings;');

  let upsertedBookings = 0;
  for (const b of bookings) {
    const doc = {
      id: String(b.id),
      property_id: String(b.property_id || 'property-1'),
      guest_name: String(b.guest_name || ''),
      guest_email: String(b.guest_email || ''),
      id_image: String(b.id_image || ''),
      guest_phone: String(b.guest_phone || ''),
      check_in: String(b.check_in || ''),
      check_out: String(b.check_out || ''),
      check_in_time: String(b.check_in_time || '14:00'),
      check_out_time: String(b.check_out_time || '11:00'),
      guests: Number(b.guests || 1),
      nights: Number(b.nights || 1),
      amount: Number(b.amount || 0),
      status: String(b.status || 'pending'),
      color: String(b.color || '#0d9488'),
      initials: String(b.initials || '??'),
      booking_source: String(b.booking_source || 'personal'),
      form_link: String(b.form_link || ''),
      form_sent: Boolean(Number(b.form_sent || 0)),
      form_sent_at: toDateOrNull(b.form_sent_at),
      host_notes: String(b.host_notes || ''),
      created_at: toDateOrNull(b.created_at) || new Date(),
      updated_at: toDateOrNull(b.updated_at) || new Date()
    };

    await Booking.findOneAndUpdate({ id: doc.id }, { $set: doc }, { upsert: true, new: true, setDefaultsOnInsert: true });
    upsertedBookings += 1;
  }

  let upsertedResponses = 0;
  for (const r of responses) {
    let responseData = {};
    try {
      responseData = r.response_data ? JSON.parse(r.response_data) : {};
    } catch {
      responseData = { raw: String(r.response_data || '') };
    }

    const doc = {
      id: String(r.id),
      booking_id: String(r.booking_id),
      response_data: responseData,
      submitted_at: toDateOrNull(r.submitted_at) || new Date()
    };

    await FormResponse.findOneAndUpdate({ id: doc.id }, { $set: doc }, { upsert: true, new: true, setDefaultsOnInsert: true });
    upsertedResponses += 1;
  }

  let upsertedSettings = 0;
  for (const s of settings) {
    const doc = { key: String(s.key), value: String(s.value ?? '') };
    await HostSetting.findOneAndUpdate({ key: doc.key }, { $set: doc }, { upsert: true, new: true, setDefaultsOnInsert: true });
    upsertedSettings += 1;
  }

  const finalBookingCount = await Booking.countDocuments();
  const finalResponseCount = await FormResponse.countDocuments();
  const finalSettingCount = await HostSetting.countDocuments();

  console.log(JSON.stringify({
    migrated: {
      bookings: upsertedBookings,
      formResponses: upsertedResponses,
      hostSettings: upsertedSettings
    },
    totalsInMongo: {
      bookings: finalBookingCount,
      formResponses: finalResponseCount,
      hostSettings: finalSettingCount
    }
  }, null, 2));

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('Migration failed:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
