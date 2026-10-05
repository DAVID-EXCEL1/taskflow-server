/**
 * Email over HTTPS APIs (works on hosts that block SMTP ports).
 *   EMAIL_PROVIDER=resend  + RESEND_API_KEY
 *   EMAIL_PROVIDER=brevo   + BREVO_API_KEY
 *   EMAIL_FROM="Taxkflow <no-reply@yourdomain.com>"
 * If not configured, send() logs a warning and returns { sent: false } - it never throws.
 */
const APP = process.env.APP_NAME || 'Taxkflow';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseFrom = (from) => { const m = String(from).match(/^(.*)<(.+)>$/); return m ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim() } : { name: APP, email: String(from).trim() }; };

async function post(url, headers, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  } finally { clearTimeout(t); }
}

async function send({ to, subject, text, html }) {
  const provider = String(process.env.EMAIL_PROVIDER || '').toLowerCase();
  const from = process.env.EMAIL_FROM;
  if (!provider || !from) { console.warn(`Email not configured - skipped "${subject}"`); return { sent: false, reason: 'not_configured' }; }
  try {
    if (provider === 'resend') await post('https://api.resend.com/emails', { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, { from, to: [to], subject, text, html });
    else if (provider === 'brevo') await post('https://api.brevo.com/v3/smtp/email', { 'api-key': process.env.BREVO_API_KEY }, { sender: parseFrom(from), to: [{ email: to }], subject, textContent: text, htmlContent: html });
    else throw new Error(`Unknown EMAIL_PROVIDER "${provider}"`);
    return { sent: true };
  } catch (e) {
    console.error(`Email failed ("${subject}"):`, e.message);
    return { sent: false, reason: 'error' };
  }
}

const layout = (title, body, button) => `<!doctype html><html><body style="margin:0;background:#F5F6F3;font-family:Arial,Helvetica,sans-serif;color:#14201B">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" style="max-width:520px;background:#fff;border:1px solid #DCE1DB;border-radius:12px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px">
<p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#0F6B4F">${esc(APP)}</p>
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>${body}
${button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#0F6B4F;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">${esc(button.text)}</a></p><p style="font-size:12px;color:#7A8781;word-break:break-all">If the button does not work, paste this link into your browser:<br>${esc(button.url)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
const p = (t) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${t}</p>`;

const templates = {
  resetPassword: (link) => ({ subject: `Reset your ${APP} password`, text: `Use this link to choose a new password (valid for 30 minutes):\n${link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`, html: layout('Reset your password', p('We received a request to reset your password. This link works for 30 minutes and can be used once.') + p('If you did not ask for this, you can ignore this email. Your password will not change.'), { url: link, text: 'Choose a new password' }) }),
  passwordChanged: () => ({ subject: `Your ${APP} password was changed`, text: 'Your password was just changed. If this was not you, reset your password immediately and contact support.', html: layout('Your password was changed', p('Your password was just changed and you were signed out on other devices.') + p('<strong>If this was not you,</strong> reset your password right away and contact support.')) }),
  twoFactorEnabled: () => ({ subject: `Two-factor authentication turned on`, text: 'Two-factor authentication was turned on for your account.', html: layout('Two-factor authentication is on', p('Two-factor authentication was turned on for your account. You will need a code from your authenticator app when you log in.')) }),
  twoFactorDisabled: () => ({ subject: `Two-factor authentication turned off`, text: 'Two-factor authentication was turned off for your account. If this was not you, change your password immediately.', html: layout('Two-factor authentication is off', p('Two-factor authentication was turned off for your account.') + p('<strong>If this was not you,</strong> change your password immediately.')) }),
  accountDeletionScheduled: ({ date, organization }) => ({ subject: `Your ${APP} account is scheduled for deletion`, text: `Your account${organization ? ' and organization are' : ' is'} scheduled to be permanently deleted on ${date}. Until then you can log in and press "Restore my account" to cancel.`, html: layout('Your account is scheduled for deletion', p(`Your account${organization ? ' and organization are' : ' is'} scheduled to be <strong>permanently deleted on ${esc(date)}</strong>.`) + p('Changed your mind? Log in any time before that date and press <strong>Restore my account</strong>. After that date it cannot be recovered.') + p('If you did not ask for this, log in and restore your account now, then change your password.')) }),
  accountDeletionCancelled: () => ({ subject: `Your ${APP} account was restored`, text: 'Your account deletion was cancelled and your account is active again.', html: layout('Your account was restored', p('Your account deletion was cancelled and your account is active again.')) }),
  paymentDetailsChanged: ({ actor, before, after }) => {
    const row = (d) => (d ? `${esc(d.bankName)} / ${esc(d.accountName)} / <strong>${esc(d.accountNumber)}</strong>` : 'none');
    return { subject: `ALERT: ${APP} payment details were changed`, text: `${actor} changed the payment details.\nBefore: ${before ? `${before.bankName} / ${before.accountName} / ${before.accountNumber}` : 'none'}\nAfter: ${after.bankName} / ${after.accountName} / ${after.accountNumber}\n\nIf this was not you, change your password and turn on two-factor authentication immediately.`, html: layout('Payment details were changed', p(`${esc(actor)} changed the account customers pay into.`) + p(`<strong>Before:</strong> ${row(before)}`) + p(`<strong>After:</strong> ${row(after)}`) + p('<strong>If this was not you,</strong> change your admin password and check your account now.')) };
  },
};
module.exports = { send, templates, esc };
