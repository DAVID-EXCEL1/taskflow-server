const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const ACCEPTED_AUDIO = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac', 'audio/wav', 'audio/webm']);
const isTrustedMediaUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['facebook.com', 'fbcdn.net', 'fbsbx.com'].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
};
async function readBounded(response) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_AUDIO_BYTES) {
    await response.body?.cancel();
    throw new Error('WhatsApp voice note is too large to transcribe.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('WhatsApp voice-note audio was empty.');
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new Error('WhatsApp voice note is too large to transcribe.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, length);
}

async function transcribeWhatsAppAudio(mediaId) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const baseUrl = String(process.env.AI_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY || '';
  if (process.env.AI_ENABLED === 'false' || !token || !baseUrl) return null;

  const mediaResponse = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v22.0'}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!mediaResponse.ok) {
    await mediaResponse.body?.cancel().catch(() => {});
    throw new Error('WhatsApp voice-note metadata could not be fetched.');
  }
  const metadata = await mediaResponse.json();
  const mimeType = String(metadata.mime_type || '').split(';')[0].toLowerCase();
  const declaredSize = Number(metadata.file_size);
  if (!metadata.url || !isTrustedMediaUrl(metadata.url) || !ACCEPTED_AUDIO.has(mimeType) || (declaredSize && declaredSize > MAX_AUDIO_BYTES)) {
    throw new Error('WhatsApp voice note has an unsupported format or size.');
  }
  const audioResponse = await fetch(metadata.url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!audioResponse.ok) {
    await audioResponse.body?.cancel().catch(() => {});
    throw new Error('WhatsApp voice-note audio could not be downloaded.');
  }
  const bytes = await readBounded(audioResponse);
  if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new Error('WhatsApp voice note is too large to transcribe.');

  const extension = mimeType.split('/')[1].replace('mpeg', 'mp3').replace('ogg', 'ogg');
  const form = new FormData();
  form.append('model', process.env.AI_STT_MODEL || 'whisper-1');
  form.append('response_format', 'json');
  form.append('file', new Blob([bytes], { type: mimeType }), `voice-note.${extension}`);
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.text !== 'string' || !result.text.trim()) {
    console.error('Voice-note transcription failed:', response.status);
    throw new Error('WhatsApp voice note could not be transcribed.');
  }
  return result.text.trim().slice(0, 10000);
}

module.exports = { transcribeWhatsAppAudio, MAX_AUDIO_BYTES, ACCEPTED_AUDIO, isTrustedMediaUrl };
