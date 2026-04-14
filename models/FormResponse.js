const mongoose = require('mongoose');

const FormResponseSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  booking_id: { type: String, required: true, index: true },
  response_data: { type: mongoose.Schema.Types.Mixed, required: true },
  submitted_at: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('FormResponse', FormResponseSchema);
