/** Google Drive: payment screenshots and participant passes, one file per registration. */
import { GoogleApiError, type GoogleClient } from './google';

const FOLDER_TYPE = 'application/vnd.google-apps.folder';
const encoder = new TextEncoder();

export interface StoredFile {
  id: string;
  name: string;
}

export interface UploadRequest {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  folderId: string;
  /** Private labels on the file (e.g. the registration ID), searchable in the Drive API. */
  properties?: Record<string, string>;
}

/** Opens the file in Google Drive (for people the folder is shared with). */
export const driveLink = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;

/** Escapes a value for a Drive search query. */
const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export class DriveStore {
  constructor(private readonly google: GoogleClient) {}

  /**
   * Uploads a file and checks Google's answer: a file ID and the exact number of bytes sent.
   * That answer is the confirmation; no second request is needed to verify it.
   */
  async upload({ name, mimeType, bytes, folderId, properties }: UploadRequest): Promise<StoredFile> {
    const boundary = `pragya-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, mimeType, parents: [folderId], appProperties: properties });
    const head = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);

    const file = await this.google.request<{ id?: string; name?: string; size?: string }>(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size',
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
      // A repeated upload after a dropped connection can only leave a spare copy, which
      // is never referenced by the sheet; the registration itself stays correct.
      { label: `Drive: upload ${name}`, idempotent: true, timeoutMs: 60_000 },
    );

    if (!file.id || Number(file.size) !== bytes.length) {
      if (file.id) await this.trash(file.id).catch(() => undefined);
      throw new GoogleApiError(`Drive: ${name} was not stored completely`, 500, 'incomplete', true, false);
    }
    return { id: file.id, name: file.name ?? name };
  }

  /** Moves a file to the Drive trash (recoverable for 30 days), e.g. after a failed registration. */
  async trash(fileId: string): Promise<void> {
    await this.google.request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) },
      { label: 'Drive: move to trash', idempotent: true },
    );
  }

  /** The folder named `name` inside `parentId`, created if it does not exist yet. */
  async ensureFolder(name: string, parentId: string): Promise<string> {
    const query = `name = ${quote(name)} and ${quote(parentId)} in parents and mimeType = '${FOLDER_TYPE}' and trashed = false`;
    const found = await this.google.request<{ files?: { id: string }[] }>(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1` +
        '&supportsAllDrives=true&includeItemsFromAllDrives=true',
      { method: 'GET' },
      { label: 'Drive: find folder', idempotent: true },
    );
    if (found.files?.[0]) return found.files[0].id;

    const created = await this.google.request<{ id: string }>(
      'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_TYPE, parents: [parentId] }),
      },
      { label: 'Drive: create folder', idempotent: false },
    );
    return created.id;
  }

  /** The folder that contains `fileId` (My Drive's root when it sits at the top). */
  async parentOf(fileId: string): Promise<string> {
    const file = await this.google.request<{ parents?: string[] }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`,
      { method: 'GET' },
      { label: 'Drive: read folder', idempotent: true },
    );
    return file.parents?.[0] ?? 'root';
  }
}
