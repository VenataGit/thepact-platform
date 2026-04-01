# ThePact Platform

Standalone video production management platform. Replaces Basecamp for internal task management.

## Tech Stack
- **Backend**: Node.js + Express, PostgreSQL, WebSocket (ws)
- **Frontend**: Vanilla JS (modular), dark theme CSS
- **Auth**: Email/password, JWT in httpOnly cookie, bcrypt
- **Real-time**: WebSocket for instant updates across all tabs
- **Hosting**: Hetzner VPS (thepact.pro), Nginx, PM2

## Quick Start
```bash
npm install
cp .env.example .env  # Edit with real values
npm run migrate        # Create tables
npm run create-admin   # Create first admin user
npm start              # Start server on :3000
```

## Key Commands
- `npm run dev` — Dev mode with auto-reload
- `npm run migrate` — Run DB migrations
- `npm run create-admin` — Create admin user (interactive)
- `npm run seed` — Seed default boards/columns

## Project Structure
- `src/routes/` — API endpoints (one file per feature)
- `src/db/queries/` — SQL query functions
- `src/ws/` — WebSocket server + broadcast
- `src/middleware/` — Auth, validation, error handling
- `src/services/` — Business logic
- `public/js/views/` — Frontend view modules
- `db/schema.sql` — Full database schema
- `scripts/` — CLI tools

## Rules
- Always push after changes (VPS auto-deploys)
- Only change what's requested
- UI text in Bulgarian, code in English
- Log every change to Changelog
