// Minimal D1 stand-in on node:sqlite, enough for the ads routes.
import { DatabaseSync } from "node:sqlite";
const norm = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);
class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args.map(norm)); }
  async first(col) { const r = this.db.prepare(this.sql).get(...this.args) ?? null; return r && col ? r[col] : r; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args), success: true, meta: {} }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
}
export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    exec: async (sql) => { db.exec(sql); return { count: 1 }; },
  };
}
