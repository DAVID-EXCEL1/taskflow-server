const asyncHandler = require('../utils/asyncHandler');
const ai = require('../services/aiService');

exports.status = asyncHandler(async (req, res) => res.json({ success: true, data: await ai.status() }));
exports.setEnabled = asyncHandler(async (req, res) => {
  await ai.setSwitch(req.body.enabled, req.user._id);
  res.json({ success: true, data: await ai.status(), message: req.body.enabled ? 'AI features are on.' : 'AI features are off. The rest of the app is unaffected.' });
});
exports.test = asyncHandler(async (req, res) => res.json({ success: true, data: await ai.testConnection() })); // throws AiUnavailableError (503) with a reason if it fails
