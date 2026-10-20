const asyncHandler = require('../utils/asyncHandler');
const company = require('../services/companyService');
const activity = require('../services/activityService');

// Public on purpose: the Help page must work for people who cannot log in.
exports.get = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ success: true, data: await company.getCompany() });
});
exports.set = asyncHandler(async (req, res) => {
  const value = await company.setCompany(req.body, req.user._id);
  await activity.log({ actor: req.user, action: 'COMPANY_DETAILS_CHANGED', message: 'Changed the business and support details', entityType: 'Setting' });
  res.json({ success: true, data: value, message: 'Business and support details saved.' });
});
