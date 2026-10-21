// The first address in CLIENT_URL (used to build links in emails).
module.exports = () => String(process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
