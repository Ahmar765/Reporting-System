/** SQL reads shared by native SQLite and the browser's in-memory reporting projection. */
export type Row = Record<string, any>;
export interface ReadDB {
  prepare(sql: string): {
    all(...params: any[]): unknown[];
    get(...params: any[]): unknown;
  };
}
export const all = (db: ReadDB, sql: string, ...params: any[]) => db.prepare(sql).all(...params) as Row[];
export const one = (db: ReadDB, sql: string, ...params: any[]) => db.prepare(sql).get(...params) as Row | undefined;
