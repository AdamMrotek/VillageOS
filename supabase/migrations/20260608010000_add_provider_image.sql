-- Provider logo/thumbnail. Stores the full CloudFront URL (the object key is
-- versioned per upload), so a re-upload yields a new URL and the CDN never
-- serves a stale image — no cache invalidation needed.
ALTER TABLE provider_profiles ADD COLUMN image_url TEXT;
