/** Gmail: builds the confirmation email (with the PDF pass attached) and sends it. */
import type { GoogleClient } from './google';

export interface Attachment {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface MailMessage {
  fromName: string;
  /** The sending Gmail address; Gmail fills it in when null. */
  fromAddress: string | null;
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  /** Optional HTML version; without it the email is plain text only. */
  html?: string;
  attachments?: Attachment[];
}

const encoder = new TextEncoder();

/** Base64 of bytes, in chunks so large attachments do not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** MIME bodies are wrapped at 76 characters a line. */
const wrap76 = (text: string) => text.replace(/.{1,76}/g, '$&\r\n');

const isAscii = (text: string) => /^[\x20-\x7e]*$/.test(text);

/**
 * A header value with non-ASCII text (e.g. "–" or "₹"), as RFC 2047 encoded words of at
 * most 75 characters, cut only between whole characters.
 */
export function encodeHeader(value: string): string {
  if (isAscii(value)) return value;
  const words: string[] = [];
  let chunk = '';
  for (const char of value) {
    if (encoder.encode(chunk + char).length > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${toBase64(encoder.encode(word))}?=`).join('\r\n ');
}

/** "PRAGYA 2026" <pragya@gmail.com> */
function address(name: string, email: string | null) {
  if (!email) return null;
  const display = isAscii(name) ? `"${name.replace(/["\\]/g, '')}"` : encodeHeader(name);
  return `${display} <${email}>`;
}

function textPart(contentType: string, content: string) {
  return [
    `Content-Type: ${contentType}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(toBase64(encoder.encode(content))),
  ].join('\r\n');
}

/** The whole email as an RFC 2822 message: text (and HTML, when given) plus attachments. */
export function buildMime(message: MailMessage, boundarySeed: string = crypto.randomUUID()): string {
  const mixed = `mixed-${boundarySeed}`;
  const alternative = `alt-${boundarySeed}`;
  const from = address(message.fromName, message.fromAddress);
  const body =
    message.html === undefined
      ? textPart('text/plain', message.text)
      : [
          `Content-Type: multipart/alternative; boundary="${alternative}"`,
          '',
          `--${alternative}`,
          textPart('text/plain', message.text),
          `--${alternative}`,
          textPart('text/html', message.html),
          `--${alternative}--`,
        ].join('\r\n');

  const headers = [
    from && `From: ${from}`,
    `To: ${message.to}`,
    message.replyTo && `Reply-To: ${message.replyTo}`,
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ].filter(Boolean);

  const parts = [
    body,
    ...(message.attachments ?? []).map((attachment) =>
      [
        `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(toBase64(attachment.bytes)),
      ].join('\r\n'),
    ),
  ];

  return [...headers, '', ...parts.map((part) => `--${mixed}\r\n${part}`), `--${mixed}--`, ''].join('\r\n');
}

/** Sends a ready-made message from the signed-in Gmail account; returns Gmail's message id. */
export async function sendMail(google: GoogleClient, mime: string): Promise<string> {
  const sent = await google.request<{ id: string }>(
    'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media',
    { method: 'POST', headers: { 'Content-Type': 'message/rfc822' }, body: mime },
    // Never repeated automatically: a lost answer could mean the email did go out. The
    // email queue tries again later instead, after a pause.
    { label: 'Gmail: send', idempotent: false, attempts: 2 },
  );
  return sent.id;
}
