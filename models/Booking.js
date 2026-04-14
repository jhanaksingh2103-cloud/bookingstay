const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  property_id: { type: String, default: 'property-1' },
  guest_name: { type: String, required: true },
  guest_email: { type: String, default: '' },
  photo_of_members: { type: String, default: '' },
  id_of_members: { type: String, default: '' },
  id_image: { type: String, default: '' },
  guest_phone: { type: String, required: true },
  check_in: { type: String, required: true },
  check_out: { type: String, required: true },
  check_in_time: { type: String, default: '14:00' },
  check_out_time: { type: String, default: '11:00' },
  guests: { type: Number, default: 1 },
  nights: { type: Number, default: 1 },
  amount: { type: Number, default: 0 },
  status: { type: String, default: 'pending' },
  color: { type: String, default: '#0d9488' },
  initials: { type: String, default: '??' },
  booking_source: { type: String, default: 'personal' },
  form_link: { type: String, default: '' },
  form_sent: { type: Boolean, default: false },
  form_sent_at: { type: Date, default: null },
  host_notes: { type: String, default: '' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('Booking', BookingSchema);
