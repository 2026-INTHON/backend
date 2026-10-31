// SQLite mirrors the private Supabase tables for local development and API tests.
export const chapterSql = `
CREATE TABLE IF NOT EXISTS malo_catalog (id TEXT PRIMARY KEY,kind TEXT NOT NULL,document TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS malo_generation_jobs (
 id TEXT PRIMARY KEY,owner_id TEXT,request_key TEXT NOT NULL UNIQUE,client_request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,
 request TEXT NOT NULL,checkpoint TEXT NOT NULL,chapter_id TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,
 worker_token TEXT,lease_until TEXT,notified_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS malo_generation_owner_idx ON malo_generation_jobs(owner_id,created_at);
CREATE TABLE IF NOT EXISTS malo_user_chapters (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,job_id TEXT NOT NULL UNIQUE,document TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS malo_push_subscriptions (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,subscription TEXT NOT NULL,updated_at TEXT NOT NULL);
`;
