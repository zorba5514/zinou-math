// الأنواع التي نستعملها من قاعدة بيانات Cloudflare D1.
// نكتبها هنا بأنفسنا حتى لا نحتاج حزمة خارجية، وتطابق واجهة D1 الرسمية.

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
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
  created_at: number;
  updated_at: number;
}

export interface Student {
  id: number;
  account_id: number;
  name: string;
  level: string;
  status: "active" | "disabled";
  created_at: number;
  updated_at: number;
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
