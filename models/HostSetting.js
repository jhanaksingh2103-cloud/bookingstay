const mongoose = require('mongoose');

const HostSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: String, required: true }
}, { versionKey: false });

module.exports = mongoose.model('HostSetting', HostSettingSchema);
