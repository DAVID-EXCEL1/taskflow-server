const asyncHandler = require('../utils/asyncHandler');
const features = require('../services/featureService');
const activity = require('../services/activityService');

// What this person may see (only true/false, never why).
exports.mine = asyncHandler(async (req, res) => res.json({ success: true, data: await features.mine() }));
exports.adminList = asyncHandler(async (req, res) => res.json({ success: true, data: await features.adminView() }));
exports.adminSet = asyncHandler(async (req, res) => {
  await features.setEnabled(req.body.key, req.body.enabled, req.user._id);
  await activity.log({ actor: req.user, action: 'FEATURE_SWITCHED', message: `${req.body.enabled ? 'Switched ON' : 'Switched OFF'} the feature "${req.body.key}"`, entityType: 'Setting' });
  const list = await features.adminView(); const f = list.find((x) => x.key === req.body.key);
  res.json({ success: true, data: list, message: req.body.enabled ? (f.available ? 'Feature is now visible to users.' : `Switched on, but it stays hidden until these keys are added on the server: ${f.missing.join(', ')}.`) : 'Feature is now hidden from users.' });
});
