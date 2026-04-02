CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER UNIQUE NOT NULL,
  topic_title TEXT NOT NULL,
  topic_url TEXT NOT NULL,
  summary TEXT NOT NULL,
  twitter_url TEXT,
  mastodon_url TEXT,
  bluesky_url TEXT,
  discord_notified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  errors TEXT
);
