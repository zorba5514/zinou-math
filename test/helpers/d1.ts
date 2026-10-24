// قاعدة بيانات للاختبارات: SQLite المدمجة في Node، بنفس واجهة Cloudflare D1.
// تُطبَّق عليها ملفات migrations نفسها التي تُطبَّق على قاعدة البيانات الحقيقية.
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import type { D1Database, D1PreparedStatement, D1Result } from "../../src/db.ts";

type Value = string | number | bigint | null | Uint8Array;

class Statement implements D1PreparedStatement {
  db: DatabaseSync;
  sql: string;
  values: Value[];
  constructor(db: DatabaseSync, sql: string, values: Value[] = []) {
    this.db = db;
    this.sql = sql;
    this.values = values;
  }
  bind(...values: unknown[]): D1PreparedStatement {
    return new Statement(
      this.db,
      this.sql,
      values.map((v) => {
        if (v === undefined) throw new Error("D1 لا يقبل undefined");
        if (typeof v === "boolean") return v ? 1 : 0;
        return v as Value;
      }),
    );
  }
  stmt(): StatementSync {
    return this.db.prepare(this.sql);
  }
  async first<T>(): Promise<T | null> {
    return (this.stmt().get(...this.values) as T | undefined) ?? null;
  }
  async all<T>(): Promise<D1Result<T>> {
    return { results: this.stmt().all(...this.values) as T[], success: true, meta: {} };
  }
  async run(): Promise<D1Result> {
    const r = this.stmt().run(...this.values);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  runSync(): D1Result {
    const r = this.stmt().run(...this.values);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function createTestDb(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const dir = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  return {
    raw: db,
    prepare: (sql: string) => new Statement(db, sql),
    // مثل D1: كل الجمل في batch تنجح معًا أو تفشل معًا.
    async batch(statements: D1PreparedStatement[]) {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => (s as Statement).runSync());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
