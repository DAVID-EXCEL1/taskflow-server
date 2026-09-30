const multer = require('multer');
const AppError = require('../utils/AppError');

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// Memory storage: the file is validated, then saved to MongoDB by the payment service (never to disk).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(new AppError('Proof must be a JPG, PNG, WEBP or PDF file.', 400))),
});
module.exports = upload;
