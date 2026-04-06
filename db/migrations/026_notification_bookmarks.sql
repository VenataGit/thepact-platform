-- Migration 026: Add bookmark support to notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_bookmarked BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_bookmarked ON notifications(user_id, is_bookmarked) WHERE is_bookmarked = TRUE;
