const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const path = require('path');

const Booking = require('./models/Booking');
const FormResponse = require('./models/FormResponse');
const HostSetting = require('./models/HostSetting');

const app = express();
const PORT = process.env.PORT || 3000;

const USERS = {
  admin: { password: 'admin123', name: 'Admin User' },
  host: { password: 'host123', name: 'Host User' }
};
const VALID_TOKENS = new Set();

const SOURCE_COLORS = { personal: '#86efac', airbnb: '#fca5a5' };
const normalizeSource = (s) => (String(s || 'personal').toLowerCase() === 'airbnb' ? 'airbnb' : 'personal');
const colorForSource = (s) => SOURCE_COLORS[normalizeSource(s)] || SOURCE_COLORS.personal;
const getInitials = (name) => String(name || '').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || '??';
const normalizeFieldKey = (key) => String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const toIsoDate = (v) => String(v || '').slice(0, 10);
const toDateTime = (d, t) => new Date(`${d}T${t}:00`);
const toHourMinute = (v, fallback) => (/^\d{2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : fallback);
const escapeRegex = (v) => String(v || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function generateToken() {
  return uuidv4();
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !VALID_TOKENS.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function getFieldValue(obj, aliases) {
  if (!obj || typeof obj !== 'object') return '';
  const wanted = aliases.map(normalizeFieldKey);
  for (const [k, v] of Object.entries(obj)) {
    if (wanted.includes(normalizeFieldKey(k))) {
      return Array.isArray(v) ? String(v[0] || '').trim() : String(v || '').trim();
    }
  }
  return '';
}

async function withResponses(bookingDoc) {
  const booking = bookingDoc?.toObject ? bookingDoc.toObject() : bookingDoc;
  const responses = await FormResponse.find({ booking_id: booking.id }).sort({ submitted_at: -1 }).lean();
  const latest = responses[0] || null;
  const booking_source = normalizeSource(booking.booking_source);
  return {
    ...booking,
    booking_source,
    color: colorForSource(booking_source),
    form_sent: !!booking.form_sent,
    form_responded: !!latest,
    form_response_count: responses.length,
    form_responses: latest ? latest.response_data : {},
    form_responses_all: responses.map((r) => ({
      id: r.id,
      submitted_at: r.submitted_at,
      data: r.response_data
    }))
  };
}

async function getSettingValue(key, fallback = '') {
  const row = await HostSetting.findOne({ key });
  return row ? row.value : fallback;
}

async function ensureDefaultSettings() {
  const defaults = {
    property_name: 'My Property',
    price_per_night: '4100',
    google_form_link: 'https://docs.google.com/forms/d/e/1FAIpQLSd2alh5nDBuQzWE34_8w5yCzINGE6hhHvy2NO-b44Noxz23yg/viewform?usp=header',
    gmail_user: 'jhanaksingh2103@gmail.com',
    gmail_app_password: ''
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (String(value) === '') continue;
    const existing = await HostSetting.findOne({ key });
    if (!existing) await HostSetting.create({ key, value: String(value) });
  }
}

async function findOverlappingBooking({ property_id, check_in, check_out, check_in_time, check_out_time, excludeId }) {
  const filter = { status: { $ne: 'cancelled' }, property_id: String(property_id || 'property-1') };
  if (excludeId) filter.id = { $ne: excludeId };

  const candidates = await Booking.find(filter);
  const newStart = toDateTime(check_in, check_in_time);
  const newEnd = toDateTime(check_out, check_out_time);
  return candidates.find((c) => {
    const start = toDateTime(c.check_in, c.check_in_time || '14:00');
    const end = toDateTime(c.check_out, c.check_out_time || '11:00');
    return start < newEnd && end > newStart;
  }) || null;
}

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.send('Server is working 🚀');
});
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/properties', (req, res) => res.sendFile(path.join(__dirname, 'public', 'properties.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = USERS[username];
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid username or password' });
  const token = generateToken();
  VALID_TOKENS.add(token);
  res.json({ success: true, token, username, name: user.name });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) VALID_TOKENS.delete(token);
  res.json({ success: true });
});

app.get('/api/auth/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !VALID_TOKENS.has(token)) return res.status(401).json({ error: 'Invalid token' });
  res.json({ success: true });
});

app.get('/api/bookings', requireAuth, async (req, res) => {
  const { month, year, property_id } = req.query;
  const pid = String(property_id || 'property-1');
  const mm = month !== undefined ? String(parseInt(month, 10) + 1).padStart(2, '0') : null;
  const yy = year !== undefined ? String(year) : null;

  let rows = await Booking.find({ status: { $ne: 'cancelled' }, property_id: pid }).sort({ check_in: 1 });
  if (mm && yy) rows = rows.filter((row) => String(row.check_in || '').startsWith(`${yy}-${mm}-`));

  res.json({ success: true, data: await Promise.all(rows.map(withResponses)) });
});

app.get('/api/bookings/:id', requireAuth, async (req, res) => {
  const b = await Booking.findOne({ id: req.params.id });
  if (!b) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: await withResponses(b) });
});

app.post('/api/bookings', requireAuth, async (req, res) => {
  const { guest_name, guest_email, guest_phone, check_in, check_out, check_in_time, check_out_time, guests, amount, booking_source, property_id } = req.body || {};
  const normalizedPropertyId = String(property_id || 'property-1').trim() || 'property-1';
  const normalizedCheckInTime = toHourMinute(check_in_time, '14:00');
  const normalizedCheckOutTime = toHourMinute(check_out_time, '11:00');
  const parsedGuests = guests === undefined || guests === null || String(guests).trim() === '' ? 1 : parseInt(guests, 10);
  const parsedAmount = parseInt(amount, 10);

  if (!guest_name || !guest_phone || !check_in || !check_out || Number.isNaN(parsedAmount) || parsedAmount <= 0 || Number.isNaN(parsedGuests) || parsedGuests <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid booking payload' });
  }

  const overlap = await findOverlappingBooking({
    property_id: normalizedPropertyId,
    check_in,
    check_out,
    check_in_time: normalizedCheckInTime,
    check_out_time: normalizedCheckOutTime
  });
  if (overlap) {
    const overlapCheckIn = `${overlap.check_in} ${overlap.check_in_time}`;
    const overlapCheckOut = `${overlap.check_out} ${overlap.check_out_time}`;
    return res.status(409).json({ success: false, message: `Booking conflicts with ${overlap.guest_name} (${overlapCheckIn} to ${overlapCheckOut})` });
  }

  const nights = Math.max(1, Math.ceil((new Date(check_out) - new Date(check_in)) / 86400000));
  const normalizedSource = normalizeSource(booking_source);
  const created = await Booking.create({
    id: uuidv4(),
    property_id: normalizedPropertyId,
    guest_name,
    guest_email: guest_email || '',
    guest_phone,
    check_in: toIsoDate(check_in),
    check_out: toIsoDate(check_out),
    check_in_time: normalizedCheckInTime,
    check_out_time: normalizedCheckOutTime,
    guests: parsedGuests,
    nights,
    amount: parsedAmount,
    status: 'pending',
    color: colorForSource(normalizedSource),
    initials: getInitials(guest_name),
    booking_source: normalizedSource,
    form_link: '',
    form_sent: false,
    host_notes: ''
  });

  res.status(201).json({ success: true, data: await withResponses(created) });
});

app.patch('/api/bookings/:id', requireAuth, async (req, res) => {
  const existing = await Booking.findOne({ id: req.params.id });
  if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

  Object.assign(existing, req.body || {});
  if (req.body?.booking_source !== undefined) {
    existing.booking_source = normalizeSource(req.body.booking_source);
    existing.color = colorForSource(existing.booking_source);
  }
  if (req.body?.guest_name !== undefined) existing.initials = getInitials(req.body.guest_name);
  existing.updated_at = new Date();
  await existing.save();
  res.json({ success: true, data: await withResponses(existing) });
});

app.delete('/api/bookings/:id', requireAuth, async (req, res) => {
  const b = await Booking.findOne({ id: req.params.id });
  if (!b) return res.status(404).json({ success: false, message: 'Not found' });
  b.status = 'cancelled';
  b.updated_at = new Date();
  await b.save();
  res.json({ success: true, message: 'Booking cancelled' });
});

app.post('/api/bookings/:id/send-form', requireAuth, async (req, res) => {
  const { form_link } = req.body;
  if (!form_link) return res.status(400).json({ success: false, message: 'form_link required' });

  const b = await Booking.findOne({ id: req.params.id });
  if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });

  const now = new Date();
  b.form_link = form_link;
  b.form_sent = true;
  b.form_sent_at = now;
  b.updated_at = now;
  await b.save();

  res.json({ success: true, message: 'Form marked as sent', data: await withResponses(b) });
});

app.post('/api/bookings/:id/send-whatsapp', requireAuth, async (req, res) => {
  const { form_link } = req.body;
  if (!form_link) return res.status(400).json({ success: false, message: 'form_link required' });

  const b = await Booking.findOne({ id: req.params.id });
  if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });

  const rawPhone = String(b.guest_phone || '').trim();
  if (!rawPhone) return res.status(400).json({ success: false, message: 'Guest phone number not found' });

  let phone = rawPhone.replace(/\D/g, '');
  if (phone.length === 10) phone = `91${phone}`;
  if (phone.length < 11) return res.status(400).json({ success: false, message: 'Invalid guest phone number for WhatsApp' });

  const propertyName = await getSettingValue('property_name', 'StayBook');
  const message = `Hi ${b.guest_name}, please fill your guest form for ${propertyName}: ${form_link}`;
  const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  const now = new Date();
  b.form_link = form_link;
  b.form_sent = true;
  b.form_sent_at = now;
  b.updated_at = now;
  await b.save();

  res.json({ success: true, message: 'WhatsApp link ready', data: { whatsapp_url: whatsappUrl } });
});

app.post('/api/submit-form/:booking_id', async (req, res) => {
  const data = req.body;
  if (!data || !Object.keys(data).length) return res.status(400).json({ success: false, message: 'No form data' });

  const guestName = getFieldValue(data, ['guest_name', 'name', 'full_name', 'fullname']);
  const guestPhone = getFieldValue(data, ['guest_phone', 'phone', 'mobile', 'phone_number', 'contact_number']);
  const guestEmail = getFieldValue(data, ['guest_email', 'email', 'email_address']);
  const photoOfMembers = getFieldValue(data, ['photo_of_members', 'photo of members', 'members photo', 'member photo', 'member_photos', 'photo']);
  const idOfMembers = getFieldValue(data, ['id_of_members', 'id of members', 'members id', 'member id', 'id_card', 'id card']);
  const idImage = getFieldValue(data, ['id_image', 'id image', 'aadhaar/id image', 'aadhaar image', 'aadhaar', 'aadhaar_id_image', 'idproof', 'id_proof_image']);

  let booking = await Booking.findOne({ id: req.params.booking_id });
  if (!booking && guestName) {
    booking = await Booking.findOne({ guest_name: { $regex: `^${escapeRegex(guestName)}$`, $options: 'i' } }).sort({ created_at: -1 });
  }
  if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

  await FormResponse.create({ id: uuidv4(), booking_id: booking.id, response_data: data });
  booking.guest_name = guestName || booking.guest_name;
  booking.guest_phone = guestPhone || booking.guest_phone;
  booking.guest_email = guestEmail || booking.guest_email;
  booking.photo_of_members = photoOfMembers || booking.photo_of_members || '';
  booking.id_of_members = idOfMembers || booking.id_of_members || '';
  booking.id_image = idImage || booking.id_image || '';
  booking.status = 'confirmed';
  booking.updated_at = new Date();
  await booking.save();

  res.json({ success: true, message: 'Response saved', data: { booking_id: booking.id, photo_of_members: booking.photo_of_members || '', id_of_members: booking.id_of_members || '', id_image: booking.id_image || '' } });
});

app.get('/api/settings', requireAuth, async (req, res) => {
  const rows = await HostSetting.find({}).lean();
  const out = {};
  rows.forEach((r) => { out[r.key] = r.value; });
  res.json({ success: true, data: out });
});

app.patch('/api/settings', requireAuth, async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    const existing = await HostSetting.findOne({ key: k });
    if (existing) {
      existing.value = String(v);
      await existing.save();
    } else {
      await HostSetting.create({ key: k, value: String(v) });
    }
  }
  res.json({ success: true, message: 'Settings updated' });
});

app.get('/api/stats', requireAuth, async (req, res) => {
  const { month, year, property_id } = req.query;
  const pid = String(property_id || 'property-1');
  const mm = String(parseInt(month ?? new Date().getMonth(), 10) + 1).padStart(2, '0');
  const yy = String(year ?? new Date().getFullYear());

  const rows = await Booking.find({ status: { $ne: 'cancelled' }, property_id: pid });
  const monthRows = rows.filter((row) => String(row.check_in || '').startsWith(`${yy}-${mm}-`));
  const totals = monthRows.reduce((acc, row) => {
    acc.total_bookings += 1;
    acc.total_nights += Number(row.nights || 0);
    acc.total_revenue += Number(row.amount || 0);
    if (row.status === 'confirmed') acc.confirmed += 1;
    if (row.status === 'pending') acc.pending += 1;
    return acc;
  }, { total_bookings: 0, total_nights: 0, total_revenue: 0, confirmed: 0, pending: 0 });

  const dim = new Date(parseInt(yy, 10), parseInt(mm, 10), 0).getDate();
  res.json({
    success: true,
    data: {
      ...totals,
      occupancy: totals.total_nights ? Math.min(100, Math.round((totals.total_nights / dim) * 100)) : 0
    }
  });
});

app.get('*', (req, res) => res.redirect('/'));

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await ensureDefaultSettings();
    app.listen(PORT, () => {
      console.log('Server running on port ' + PORT);
    });
  })
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
