-- Migration 012: Add sender_name to notifications for avatar display in Hey! inbox

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255);
