-- Migration 029: Add missing indexes for frequently filtered/joined columns.
-- These were identified during the comprehensive code review (Phase 4 cleanup).
-- All indexes use IF NOT EXISTS so this migration is idempotent.

-- cards: creator_id is filtered in dashboards, "my stuff", reports
CREATE INDEX IF NOT EXISTS idx_cards_creator
  ON cards(creator_id) WHERE creator_id IS NOT NULL;

-- cards: created_at is sorted in activity feeds and reports
CREATE INDEX IF NOT EXISTS idx_cards_created_at
  ON cards(created_at DESC);

-- cards: trashed_at speeds up the trash view (filtered by NOT NULL + last 30d)
CREATE INDEX IF NOT EXISTS idx_cards_trashed
  ON cards(trashed_at) WHERE trashed_at IS NOT NULL;

-- card_assignees: card_id is the most common JOIN column for "who's on this card"
CREATE INDEX IF NOT EXISTS idx_card_assignees_card
  ON card_assignees(card_id);

-- card_steps: assignee_id is filtered when showing per-user task lists
CREATE INDEX IF NOT EXISTS idx_card_steps_assignee
  ON card_steps(assignee_id) WHERE assignee_id IS NOT NULL;

-- columns: composite index for "ordered columns of a board" queries
CREATE INDEX IF NOT EXISTS idx_columns_board_position
  ON columns(board_id, position);

-- chat_messages: composite for "channel messages ordered by date"
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created
  ON chat_messages(channel_id, created_at DESC);

-- card_comments: card_id + created_at for paginated comment lists
CREATE INDEX IF NOT EXISTS idx_card_comments_card_created
  ON card_comments(card_id, created_at DESC);

-- activity_log: created_at for the global activity feed
CREATE INDEX IF NOT EXISTS idx_activity_log_created
  ON activity_log(created_at DESC);

-- card_events: composite for per-card history queries (already has card_id index)
CREATE INDEX IF NOT EXISTS idx_card_events_card_created
  ON card_events(card_id, created_at DESC);

-- notifications: composite improves "my unread notifications" queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
