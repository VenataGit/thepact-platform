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

## Design Reference (Basecamp Clone Style)

### Color Palette
- `--bg-color: #111a1e` (very dark, nearly black background)
- `--card-green: #4a6d5d` / `--card-teal` / `--card-gold: #8c734b` / `--card-red: #8c4b4b`
- `--text-white: #e6e6e6`
- `--btn-primary: #46a374` (green action buttons)

### Layout Principles
- Muted "earthy" tones on very dark background — reduces eye strain
- Sans-serif font with varied weights (bold titles, light secondary)
- Symmetric layout, centered logo and action buttons
- Functional blocks in logical grids

### Key Components
- **Project Cards**: 4-column grid, 12px radius, colored backgrounds, min-height 150px, centered
- **Dashboard Split**: 2-column grid — Schedule (calendar widget) left, Assignments right
- **Panels**: `rgba(255,255,255,0.05)` background, 15px radius, 25px padding
- **Buttons**: green primary (`#46a374`), 20px border-radius, bold white text

### Card Edit Mode
- WYSIWYG editor with toolbar (B/I/S/Link/Lists/Quote/Code)
- `contenteditable="true"` for rich text editing
- Radio buttons for due date selection
- Save (green) / Discard (underline link) action buttons
- Steps checklist with inline "Add new step" input
- Editor container: `rgba(0,0,0,0.2)` background, 1px border

## Rules
- Always push after changes (VPS auto-deploys)
- Only change what's requested
- UI text in Bulgarian, code in English
- Log every change to Changelog
