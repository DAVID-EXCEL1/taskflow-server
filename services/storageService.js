/**
 * Receipt (proof of payment) storage.
 *  - If Cloudinary is configured, new receipts are uploaded there as PRIVATE ("authenticated") files:
 *    they have no public link, and are only ever served through our own permission-checked endpoint.
 *  - If Cloudinary is not configured, or an upload fails, the receipt is saved in MongoDB instead, so a receipt is never lost.
 * Configure with CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME  (or the three CLOUDINARY_* variables).
 */
const { v2: cloudinary } = require('cloudinary');

const enabled = () => !!(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));
function configure() {
  if (process.env.CLOUDINARY_URL) cloudinary.config({ secure: true });
  else cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, secure: true });
}

function uploadReceipt(file) {
  configure();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'taskdesk/receipts', type: 'authenticated', resource_type: 'auto', allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'], overwrite: false },
      (err, res) => (err ? reject(err) : resolve({ publicId: res.public_id, resourceType: res.resource_type, format: res.format })),
    );
    stream.end(file.buffer);
  });
}

// Returns { cloudinary: {...} } when stored in Cloudinary, or null meaning "caller must save it in the database".
async function storeReceipt(file) {
  if (!file || !enabled()) return null;
  try { return { cloudinary: await uploadReceipt(file) }; }
  catch (e) { console.error('Cloudinary upload failed - saving the receipt in the database instead:', e.message); return null; }
}

// Fetches the private original through a signed, 60-second download link and returns its bytes.
async function downloadReceipt({ publicId, resourceType, format }) {
  configure();
  const url = cloudinary.utils.private_download_url(publicId, format || '', { resource_type: resourceType || 'image', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 60 });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cloudinary responded ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
module.exports = { enabled, storeReceipt, downloadReceipt };
