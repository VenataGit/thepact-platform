-- Ensure every board (type='board') has a Done column
-- Adds one at the end (max position + 1) for boards that are missing it
INSERT INTO columns (board_id, title, position, is_done_column)
SELECT b.id, 'Done', COALESCE((SELECT MAX(c.position) FROM columns c WHERE c.board_id = b.id), -1) + 1, TRUE
FROM boards b
WHERE b.type = 'board'
  AND NOT EXISTS (SELECT 1 FROM columns c WHERE c.board_id = b.id AND c.is_done_column = TRUE);
