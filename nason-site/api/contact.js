// NASON HOME — contact form email endpoint (Vercel Serverless Function)
// Receives the お問い合わせ form submission, validates it server-side,
// and sends a formatted email via Resend. The API key is read only from
// the environment; it is never exposed to the browser.
import { Resend } from 'resend';

const RECIPIENT = 'nasonhome.jp@gmail.com';
const SUBJECT = '【NASON HOME】お問い合わせ';
// Override with a verified domain sender in Vercel once your domain is set up,
// e.g. "NASON HOME <no-reply@nasonhome.jp>". Falls back to Resend's shared
// onboarding sender so the endpoint works before a domain is verified.
const FROM = process.env.CONTACT_FROM_EMAIL || 'NASON HOME <onboarding@resend.dev>';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Escape user input before interpolating into the HTML email. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Normalise an incoming field to a trimmed string of at most `max` chars. */
function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/** Server-side validation. Never trust the client. Returns { data } or { errors }. */
function validate(body) {
  const data = {
    name: str(body.name, 100),
    email: str(body.email, 200),
    phone: str(body.phone, 50),
    type: str(body.type, 100),
    language: str(body.language, 50),
    message: str(body.message, 5000),
    privacy: body.privacy === true || body.privacy === 'true' || body.privacy === 'on',
  };

  const errors = {};
  if (!data.name) errors.name = 'お名前を入力してください。';
  if (!data.email) errors.email = 'メールアドレスを入力してください。';
  else if (!EMAIL_RE.test(data.email)) errors.email = 'メールアドレスの形式が正しくありません。';
  if (!data.message) errors.message = 'お問い合わせ内容を入力してください。';
  if (!data.privacy) errors.privacy = 'プライバシーポリシーへの同意が必要です。';

  return Object.keys(errors).length ? { errors } : { data };
}

function buildHtml(data, sentAt) {
  const rows = [
    ['お名前', data.name],
    ['メールアドレス', data.email],
    ['電話番号', data.phone || '（未入力）'],
    ['お問い合わせ種別', data.type || '（未選択）'],
    ['ご希望言語', data.language || '（未選択）'],
  ]
    .map(
      ([label, value]) => `
        <tr>
          <th style="text-align:left;padding:10px 14px;background:#f5f6f8;border:1px solid #e7e9ee;font-weight:600;color:#111;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</th>
          <td style="padding:10px 14px;border:1px solid #e7e9ee;color:#3e4a5b;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join('');

  return `
  <div style="font-family:'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif;max-width:640px;margin:0 auto;color:#111;">
    <div style="background:#2563EB;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;font-size:18px;">${escapeHtml(SUBJECT)}</h1>
      <p style="margin:6px 0 0;font-size:13px;opacity:.9;">ウェブサイトのお問い合わせフォームから送信されました。</p>
    </div>
    <div style="border:1px solid #e7e9ee;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tbody>${rows}</tbody>
      </table>
      <h2 style="font-size:14px;margin:24px 0 8px;color:#111;">お問い合わせ内容</h2>
      <div style="padding:14px;background:#f5f6f8;border:1px solid #e7e9ee;border-radius:8px;font-size:14px;line-height:1.7;color:#3e4a5b;white-space:pre-wrap;">${escapeHtml(data.message)}</div>
      <p style="margin:24px 0 0;font-size:12px;color:#7a8494;">送信日時：${escapeHtml(sentAt)}</p>
    </div>
  </div>`;
}

function buildText(data, sentAt) {
  return [
    `お名前：${data.name}`,
    `メールアドレス：${data.email}`,
    `電話番号：${data.phone || '（未入力）'}`,
    `お問い合わせ種別：${data.type || '（未選択）'}`,
    `ご希望言語：${data.language || '（未選択）'}`,
    '',
    'お問い合わせ内容：',
    data.message,
    '',
    `送信日時：${sentAt}`,
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not configured.');
    return res.status(500).json({ ok: false, error: 'メール送信の設定が完了していません。' });
  }

  // Vercel parses JSON bodies automatically; guard against string/empty bodies.
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ ok: false, error: 'リクエストの形式が正しくありません。' });
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ ok: false, error: 'リクエストの形式が正しくありません。' });
  }

  const { data, errors } = validate(body);
  if (errors) {
    return res.status(400).json({ ok: false, error: '入力内容をご確認ください。', errors });
  }

  const sentAt = new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date());

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM,
      to: RECIPIENT,
      subject: SUBJECT,
      replyTo: data.email,
      html: buildHtml(data, sentAt),
      text: buildText(data, sentAt),
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(502).json({ ok: false, error: '送信に失敗しました。時間をおいて再度お試しください。' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Unexpected error sending contact email:', err);
    return res.status(500).json({ ok: false, error: '送信に失敗しました。時間をおいて再度お試しください。' });
  }
}
