import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { AttachmentStore } from './attachments.js';

const PART_BYTES = 256 * 1024;
export interface StagedAttachments extends AttachmentStore {
  prepare(): Promise<void>;
  rollback(): Promise<void>;
  finish(): Promise<void>;
}

/** Small, private attachments use Firestore's free storage quota, not paid Cloud Storage. */
export class FirestoreAttachments implements StagedAttachments {
  private uploads = new Map<string, { bytes: Buffer; contentType: string }>();
  private deletes = new Set<string>();
  private saved: string[] = [];
  constructor(private firestore: Firestore) {}
  private file(name: string) {
    if (!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(name)) throw Error('Invalid attachment object name.');
    return this.firestore.collection('cadenceAttachments').doc(name);
  }
  async put(name: string, bytes: Buffer, contentType: string) {
    this.file(name);
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw Error('Attachment exceeds the 5 MB limit.');
    this.uploads.set(name, { bytes, contentType });
    this.deletes.delete(name);
  }
  async get(name: string) {
    if (this.uploads.has(name)) return this.uploads.get(name)!.bytes;
    const file = this.file(name);
    const manifest = await file.get();
    if (!manifest.exists) throw Error('Attachment not found.');
    const parts = await file.collection('parts').orderBy('index').get();
    if (parts.size !== manifest.get('parts') || parts.docs.some((part, i) => part.get('index') !== i)) throw Error('Attachment is incomplete.');
    const bytes = Buffer.concat(parts.docs.map(part => Buffer.from(part.get('bytes'))));
    if (bytes.length !== manifest.get('size') || createHash('sha256').update(bytes).digest('hex') !== manifest.get('sha256')) throw Error('Attachment integrity check failed.');
    return bytes;
  }
  async remove(name: string) {
    this.file(name);
    if (!this.uploads.delete(name)) this.deletes.add(name);
  }
  async prepare() {
    for (const [name, { bytes, contentType }] of this.uploads) {
      const file = this.file(name);
      const batch = this.firestore.batch();
      const count = Math.ceil(bytes.length / PART_BYTES);
      batch.create(file, { size: bytes.length, parts: count, sha256: createHash('sha256').update(bytes).digest('hex'), contentType, createdAt: new Date().toISOString() });
      for (let index = 0; index < count; index++) batch.create(file.collection('parts').doc(String(index).padStart(3, '0')), {
        index, bytes: bytes.subarray(index * PART_BYTES, (index + 1) * PART_BYTES)
      });
      await batch.commit();
      this.saved.push(name);
    }
  }
  private async deleteFile(name: string) {
    const file = this.file(name);
    const parts = await file.collection('parts').get();
    const batch = this.firestore.batch();
    for (const part of parts.docs) batch.delete(part.ref);
    batch.delete(file);
    await batch.commit();
  }
  async rollback() {
    await Promise.all(this.saved.map(async name => {
      try { await this.deleteFile(name); } catch { console.error('Uncommitted attachment cleanup failed:', name); }
    }));
  }
  async finish() {
    await Promise.all([...this.deletes].map(async name => {
      try { await this.deleteFile(name); } catch { console.error('Attachment object cleanup is pending:', name); }
    }));
  }
}
