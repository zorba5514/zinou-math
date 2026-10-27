// الأنواع التي نستعملها من قاعدة بيانات Cloudflare D1.
// نكتبها هنا بأنفسنا حتى لا نحتاج حزمة خارجية، وتطابق واجهة D1 الرسمية.

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number; served_by?: string; served_by_region?: string };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

/** ما نستعمله من مخزن الملفات R2 (نفس واجهة Cloudflare الرسمية). */
export interface R2ObjectBody {
  body: ReadableStream;
  size: number;
}

export interface R2Bucket {
  put(key: string, value: ArrayBuffer | ReadableStream | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(keys: string | string[]): Promise<void>;
}

export interface Account {
  id: number;
  role: "parent" | "admin";
  phone: string;
  name: string;
  password_hash: string;
  must_change_password: number;
  status: "active" | "disabled";
  failed_attempts: number;
  locked_until: number | null;
  totp_secret: string | null;
  note: string | null;
  parent_pin_hash: string | null;
  parent_pin_failed: number;
  parent_pin_locked_until: number | null;
  created_at: number;
  updated_at: number;
}

export interface Student {
  id: number;
  account_id: number;
  name: string;
  level: string;
  status: "active" | "disabled";
  pin_hash: string | null;
  pin_failed: number;
  pin_locked_until: number | null;
  created_at: number;
  updated_at: number;
}

export interface Device {
  id: number;
  account_id: number;
  token_hash: string;
  label: string | null;
  status: "pending" | "approved" | "revoked";
  created_at: number;
  last_used_at: number | null;
}

export async function audit(
  db: D1Database,
  actorId: number | null,
  action: string,
  target: string | null = null,
  detail: string | null = null,
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (at, actor_id, action, target, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(Date.now(), actorId, action, target, detail)
    .run();
}
