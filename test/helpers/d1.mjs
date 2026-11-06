import { DatabaseSync } from "node:sqlite";

// Execute the Worker's actual SQL against SQLite, including atomic D1 batches.
export function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  const DB = {
    prepare(sql) {
      let bindings = {};
      return {
        bind(...values) {
          bindings = Object.fromEntries(values.map((value, index) => [index + 1, value]));
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(bindings) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(sql).all(bindings), success: true };
        },
        async run() {
          return this.runSync();
        },
        runSync() {
          const statement = sqlite.prepare(sql);
          // D1 batch returns rows for SELECT statements as well as write metadata.
          if (statement.columns().length) {
            return { results: statement.all(bindings), success: true };
          }
          return { meta: statement.run(bindings), results: [], success: true };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(statement.runSync());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { DB, sqlite };
}
