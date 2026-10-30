const configured = () => !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

async function sendMorningPlan(to, message) {
  if (!configured()) throw new Error('WhatsApp Cloud API is not configured.');
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v22.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(to).replace(/\D/g, ''),
      type: 'template',
      template: {
        name: process.env.WHATSAPP_MORNING_PLAN_TEMPLATE || 'morning_plan',
        language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: String(message).slice(0, 1000) }] }],
      },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    console.error('WhatsApp message delivery failed:', response.status);
    throw new Error('WhatsApp message could not be sent.');
  }
  await response.body?.cancel();
  return { sent: true };
}

module.exports = { sendMorningPlan, configured };
