const AppError = require('../utils/AppError');
module.exports = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const fields = {};
    result.error.issues.forEach((i) => { fields[i.path.join('.') || 'form'] = i.message; });
    return next(new AppError(Object.values(fields)[0] || 'Invalid input.', 400, { fields }));
  }
  req.body = result.data;
  next();
};
