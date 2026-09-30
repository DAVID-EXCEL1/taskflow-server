const AppError = require('../utils/AppError');

const notFound = (req, res, next) => next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let status = err.statusCode || 500;
  let message = err.message;
  let details = err.details;

  if (err.name === 'ValidationError' && err.errors) { status = 400; message = Object.values(err.errors)[0].message; }
  else if (err.name === 'CastError') { status = 400; message = 'Invalid identifier supplied.'; }
  else if (err.code === 11000) { status = 409; message = 'That value already exists.'; }
  else if (err.name === 'MulterError') { status = 400; message = err.code === 'LIMIT_FILE_SIZE' ? 'Proof file must be 3MB or smaller.' : 'File upload failed.'; }
  else if (!err.isOperational) {
    console.error(err);
    status = 500;
    message = 'Something went wrong on our side. Please try again.';
    details = undefined;
  }
  res.status(status).json({ success: false, message, ...(details ? { details } : {}) });
};
module.exports = { notFound, errorHandler };
