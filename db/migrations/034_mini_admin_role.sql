-- Add mini_admin role — between moderator and admin
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'mini_admin', 'moderator', 'member'));
