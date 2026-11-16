import { DatabaseSync } from "node:sqlite";

export function createUsage(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY, at INTEGER NOT NULL, feature TEXT NOT NULL,
      model TEXT NOT NULL, counted INTEGER NOT NULL, outcome TEXT NOT NULL,
      status INTEGER, duration_ms INTEGER, items INTEGER
    );
    CREATE INDEX IF NOT EXISTS usage_events_at ON usage_events(at);`);
  const columns = new Set(db.prepare("PRAGMA table_info(usage_events)").all().map(column => column.name));
  for (const column of ["provider", "error_category", "requested_model"]) {
    if (!columns.has(column)) db.exec(`ALTER TABLE usage_events ADD COLUMN ${column} TEXT`);
  }
  return {
    start({feature, model, requestedModel = null, counted, outcome = "pending", status = null, items = null}, now = Date.now()) {
      return Number(db.prepare("INSERT INTO usage_events(at,feature,model,counted,outcome,status,items,requested_model) VALUES(?,?,?,?,?,?,?,?)")
        .run(now, feature, model, counted ? 1 : 0, outcome, status, items, requestedModel).lastInsertRowid);
    },
    finish(id, outcome, status, duration, details = {}) {
      db.prepare("UPDATE usage_events SET outcome=?,status=?,duration_ms=?,provider=?,error_category=? WHERE id=?")
        .run(outcome, status, duration, details.provider ?? null, details.category ?? null, id);
    },
    report(day, now = Date.now()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day) throw new Error("Invalid UTC date");
      const start = Date.parse(`${day}T00:00:00Z`), end = start + 86400000;
      const groups = db.prepare(`SELECT feature,model,outcome,status,counted,COUNT(*) AS calls,SUM(items) AS items
        FROM usage_events WHERE at>=? AND at<? GROUP BY feature,model,outcome,status,counted ORDER BY calls DESC`).all(start,end);
      const counted = groups.filter(g=>g.counted).reduce((n,g)=>n+g.calls,0);
      const total = db.prepare("SELECT * FROM daily WHERE day=?").get(day);
      const legacy = Math.max(0,(total?.used??0)-counted);
      const legacyBackfill = Math.min(legacy,Math.max(0,(total?.backfill_used??0)-groups.filter(g=>g.counted&&g.feature==="Old email tagging").reduce((n,g)=>n+g.calls,0)));
      const hourly = Array.from({length:24},(_,hour)=>({hour:String(hour).padStart(2,"0"),calls:0,failed:0,blocked:0}));
      for (const row of db.prepare(`SELECT CAST(strftime('%H',at/1000,'unixepoch') AS INTEGER) AS hour,
        SUM(counted) AS calls,SUM(CASE WHEN counted=1 AND outcome='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN counted=0 THEN 1 ELSE 0 END) AS blocked FROM usage_events WHERE at>=? AND at<? GROUP BY hour`).all(start,end)) Object.assign(hourly[row.hour],row,{hour:String(row.hour).padStart(2,"0")});
      const history = db.prepare(`SELECT d.day,d.used AS calls,
        COALESCE(e.tracked,0) AS tracked,COALESCE(e.failed,0) AS failed,COALESCE(e.blocked,0) AS blocked
        FROM daily d LEFT JOIN (SELECT strftime('%Y-%m-%d',at/1000,'unixepoch') AS day,SUM(counted) AS tracked,
        SUM(CASE WHEN counted=1 AND outcome='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN counted=0 THEN 1 ELSE 0 END) AS blocked FROM usage_events GROUP BY day) e ON e.day=d.day
        ORDER BY d.day DESC`).all();
      const recent = db.prepare("SELECT at,feature,model,counted,outcome,status,duration_ms,items,provider,error_category,requested_model FROM usage_events WHERE at>=? AND at<? ORDER BY at DESC,id DESC LIMIT 100").all(start,end);
      return {day,generatedAt:new Date(now).toISOString(),total:Math.max(total?.used??0,counted),counted,legacy,legacyBackfill,
        legacyUnattributed:legacy-legacyBackfill,groups,hourly,history,recent,
        firstTrackedAt:db.prepare("SELECT MIN(at) AS at FROM usage_events").get().at};
    },
    close(){db.close();}
  };
}
