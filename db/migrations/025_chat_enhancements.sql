-- Chat system enhancements: attachments, unread tracking, group management

-- Channel: avatar + updated_at tracking
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Messages: attachments, message types, editing
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(500);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(100);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- Members: read tracking + roles
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'member';

-- Set creator as admin for existing channels
UPDATE chat_members cm SET role = 'admin'
FROM chat_channels ch
WHERE cm.channel_id = ch.id AND cm.user_id = ch.created_by AND cm.role = 'member';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_date ON chat_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_channel_user ON chat_members(channel_id, user_id);

-- Update updated_at on existing channels
UPDATE chat_channels ch SET updated_at = COALESCE(
  (SELECT MAX(created_at) FROM chat_messages WHERE channel_id = ch.id),
  ch.created_at
);
