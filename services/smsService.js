const configured = () => !!(process.env.AT_USERNAME && process.env.AT_API_KEY);
const endpoint = () => process.env.AT_ENV === 'sandbox'
  ? 'https://api.sandbox.africastalking.com/version1/messaging'
  : 'https://api.africastalking.com/version1/messaging';

async function sendSms({ to, message }) {
  if (!configured()) throw new Error('Africa’s Talking SMS is not configured.');
  const form = new URLSearchParams({
    username: process.env.AT_USERNAME,
    to,
    message,
    ...(process.env.AT_SENDER_ID ? { from: process.env.AT_SENDER_ID } : {}),
  });
  const response = await fetch(endpoint(), {
    method: 'POST',
    headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({}));
  const recipients = result.SMSMessageData?.Recipients || [];
  const accepted = response.ok && recipients.some((item) => ['100', '101', '102'].includes(String(item.statusCode)));
  if (!accepted) {
    console.error('Africa’s Talking SMS delivery failed:', response.status || result.SMSMessageData?.Message || 'provider rejected request');
    throw new Error('SMS could not be sent. Please try again later.');
  }
  return { sent: true };
}

module.exports = { sendSms, configured };
