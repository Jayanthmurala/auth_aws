-- Performance optimization indexes for auth service
-- Run this script to add critical indexes for high-performance queries

-- Users table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_active 
ON "User" (email) WHERE status = 'ACTIVE';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_college_role 
ON "User" ("collegeId", roles) WHERE status = 'ACTIVE';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_login 
ON "User" ("lastLoginAt" DESC) WHERE "lastLoginAt" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at 
ON "User" ("createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_verified 
ON "User" ("emailVerifiedAt") WHERE "emailVerifiedAt" IS NOT NULL;

-- Security tokens table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_tokens_user_type_active 
ON "SecurityToken" ("userId", type) WHERE "usedAt" IS NULL AND "expiresAt" > NOW();

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_tokens_expires_at 
ON "SecurityToken" ("expiresAt") WHERE "usedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_tokens_cleanup 
ON "SecurityToken" ("expiresAt", "usedAt") WHERE "expiresAt" < NOW() OR "usedAt" IS NOT NULL;

-- OAuth accounts table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oauth_accounts_user_provider 
ON "OAuthAccount" ("userId", provider);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oauth_accounts_provider_id 
ON "OAuthAccount" (provider, "providerAccountId");

-- User preferences table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_preferences_user_id 
ON "UserPreferences" ("userId");

-- College table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_colleges_active 
ON "College" ("isActive") WHERE "isActive" = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_colleges_name 
ON "College" (name) WHERE "isActive" = true;

-- Audit logs table indexes (if exists)
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_action_time 
-- ON "AuditLog" ("userId", action, "createdAt" DESC);

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created_at 
-- ON "AuditLog" ("createdAt" DESC);

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email_status_roles 
ON "User" (email, status, roles);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_tokens_user_type_expires 
ON "SecurityToken" ("userId", type, "expiresAt") WHERE "usedAt" IS NULL;

-- Partial indexes for frequently filtered data
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_students 
ON "User" ("collegeId", department, year) 
WHERE status = 'ACTIVE' AND 'STUDENT' = ANY(roles);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_faculty 
ON "User" ("collegeId", department) 
WHERE status = 'ACTIVE' AND 'FACULTY' = ANY(roles);

-- Text search indexes for user search functionality
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_search_name 
ON "User" USING gin(to_tsvector('english', "displayName")) 
WHERE status = 'ACTIVE';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_search_email 
ON "User" USING gin(to_tsvector('english', email)) 
WHERE status = 'ACTIVE';

-- Performance monitoring views
CREATE OR REPLACE VIEW user_login_stats AS
SELECT 
    DATE_TRUNC('day', "lastLoginAt") as login_date,
    COUNT(*) as daily_logins,
    COUNT(DISTINCT "collegeId") as colleges_active
FROM "User" 
WHERE "lastLoginAt" >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', "lastLoginAt")
ORDER BY login_date DESC;

CREATE OR REPLACE VIEW token_usage_stats AS
SELECT 
    type,
    COUNT(*) as total_tokens,
    COUNT(*) FILTER (WHERE "usedAt" IS NULL AND "expiresAt" > NOW()) as active_tokens,
    COUNT(*) FILTER (WHERE "usedAt" IS NOT NULL) as used_tokens,
    COUNT(*) FILTER (WHERE "expiresAt" <= NOW()) as expired_tokens
FROM "SecurityToken"
GROUP BY type;

-- Add comments for documentation
COMMENT ON INDEX idx_users_email_active IS 'Optimizes user lookup by email for active users';
COMMENT ON INDEX idx_users_college_role IS 'Optimizes queries filtering by college and role';
COMMENT ON INDEX idx_security_tokens_user_type_active IS 'Optimizes token validation queries';
COMMENT ON INDEX idx_users_search_name IS 'Full-text search index for user names';

-- Analyze tables to update statistics
ANALYZE "User";
ANALYZE "SecurityToken";
ANALYZE "OAuthAccount";
ANALYZE "UserPreferences";
ANALYZE "College";
