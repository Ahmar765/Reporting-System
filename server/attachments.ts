import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

/** All attachment access stays behind the authenticated API. */
export interface AttachmentStore {
  put(name: string, bytes: Buffer, contentType: string): Promise<void>;
  get(name: string): Promise<Buffer>;
  remove(name: string): Promise<void>;
}

export function localAttachments(directory = resolve('./data/uploads')): AttachmentStore {
  const path = (name: string) => {
    if (!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(name)) throw Error('Invalid attachment object name.');
    return resolve(directory, name);
  };
  return {
    async put(name, bytes) {
      await mkdir(directory, { recursive: true });
      await writeFile(path(name), bytes, { flag: 'wx' });
    },
    get: name => readFile(path(name)),
    remove: name => unlink(path(name)).catch(() => {})
  };
}
