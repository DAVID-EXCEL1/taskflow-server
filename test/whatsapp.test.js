const test = require('node:test');
const assert = require('node:assert/strict');
const whatsapp = require('../services/whatsappService');

test('WhatsApp morning plans use an approved template and a normalized recipient', async () => {
  const previous = {
    token: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    template: process.env.WHATSAPP_MORNING_PLAN_TEMPLATE,
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE,
  };
  const originalFetch = global.fetch;
  let request;
  process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '12345';
  process.env.WHATSAPP_MORNING_PLAN_TEMPLATE = 'daily_plan';
  process.env.WHATSAPP_TEMPLATE_LANGUAGE = 'en_GB';
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, body: { cancel: async () => {} } };
  };
  try {
    assert.deepEqual(await whatsapp.sendMorningPlan('+234 801-234-5678', 'Tasks for today'), { sent: true });
    assert.match(request.url, /12345\/messages$/);
    assert.equal(request.options.method, 'POST');
    const body = JSON.parse(request.options.body);
    assert.equal(body.to, '2348012345678');
    assert.equal(body.template.name, 'daily_plan');
    assert.equal(body.template.language.code, 'en_GB');
    assert.equal(body.template.components[0].parameters[0].text, 'Tasks for today');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      WHATSAPP_ACCESS_TOKEN: previous.token,
      WHATSAPP_PHONE_NUMBER_ID: previous.phoneId,
      WHATSAPP_MORNING_PLAN_TEMPLATE: previous.template,
      WHATSAPP_TEMPLATE_LANGUAGE: previous.language,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
