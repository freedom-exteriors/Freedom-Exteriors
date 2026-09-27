// Where uploaded schedule photos live. Production: a *private* Supabase Storage bucket
// (photos of kids' schedules / client data are never public). Dev: a local folder.
// Images are served back only through an auth-checked API route.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export interface PhotoStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class LocalDiskPhotoStore implements PhotoStore {
  constructor(private readonly root: string) {}
  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("bad key");
    return p;
  }
  async put(key: string, bytes: Buffer) {
    await mkdir(path.dirname(this.file(key)), { recursive: true });
    await writeFile(this.file(key), bytes);
  }
  get(key: string) {
    return readFile(this.file(key));
  }
  async remove(key: string) {
    await rm(this.file(key), { force: true });
  }
}

export class SupabasePhotoStore implements PhotoStore {
  private readonly bucket;
  constructor(url: string, serviceRoleKey: string, bucket: string) {
    this.bucket = createClient(url, serviceRoleKey, { auth: { persistSession: false } }).storage.from(bucket);
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    const { error } = await this.bucket.upload(key, bytes, { contentType, upsert: false });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
  }
  async get(key: string) {
    const { data, error } = await this.bucket.download(key);
    if (error || !data) throw new Error(`storage download failed: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(key: string) {
    await this.bucket.remove([key]);
  }
}

export class MemoryPhotoStore implements PhotoStore {
  readonly files = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer) {
    this.files.set(key, bytes);
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error("not found");
    return f;
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}
