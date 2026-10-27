-- "Rate this tool" (worker/ratings.ts). Apply with: npx wrangler@4 d1 migrations apply rounder-ratings --remote

-- one row per rating: the tool, 1–5 stars, an optional short comment and the UTC day. No IP, no cookie, no account.
CREATE TABLE ratings (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT CHECK (comment IS NULL OR length(comment) <= 280),
  day TEXT NOT NULL
);
CREATE INDEX ratings_slug ON ratings (slug);

-- today's random salt. Yesterday's is deleted at midnight UTC, after which no stored hash can be matched to an IP again.
CREATE TABLE salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);

-- today's voters, for rate limiting only: SHA-256(today's salt + IP), never the IP itself. Cleared with the salt, so
-- ratings can't be linked to each other or to a visitor afterwards.
CREATE TABLE voters (
  day TEXT NOT NULL,
  voter TEXT NOT NULL,
  slug TEXT NOT NULL,
  rating_id INTEGER NOT NULL,
  PRIMARY KEY (day, voter, slug)
);
