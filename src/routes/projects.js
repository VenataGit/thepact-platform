const express = require('express');
const router = express.Router();
const { query, queryOne, execute } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { broadcast } = require('../ws/broadcast');

// GET /api/projects — list projects user is member of
router.get('/', requireAuth, async (req, res) => {
  try {
    const projects = await query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM boards b WHERE b.project_id = p.id) as board_count,
        COALESCE(
          (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'role', pm.role))
           FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = p.id),
          '[]'::json
        ) as members
      FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = $1 AND p.is_archived = FALSE
      ORDER BY p.is_pinned DESC, p.name
    `, [req.user.userId]);
    res.json(projects);
  } catch (err) {
    console.error('Projects list error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id — single project with members
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const project = await queryOne(`
      SELECT p.*,
        COALESCE(
          (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'role', pm.role, 'avatar_url', u.avatar_url))
           FROM project_members pm JOIN users u ON pm.user_id = u.id WHERE pm.project_id = p.id),
          '[]'::json
        ) as members
      FROM projects p WHERE p.id = $1
    `, [req.params.id]);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    console.error('Project get error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects — create project (admin)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const project = await queryOne(
      `INSERT INTO projects (name, description, color, creator_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), description || null, color || '#1cb0f6', req.user.userId]
    );
    // Add creator as member
    await execute(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [project.id, req.user.userId]
    );
    broadcast({ type: 'project:created', project });
    res.status(201).json(project);
  } catch (err) {
    console.error('Project create error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:id — update project
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, description, color, is_pinned } = req.body;
    const project = await queryOne(
      `UPDATE projects SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        color = COALESCE($3, color),
        is_pinned = COALESCE($4, is_pinned),
        updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name, description, color, is_pinned, req.params.id]
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    broadcast({ type: 'project:updated', project });
    res.json(project);
  } catch (err) {
    console.error('Project update error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id — archive project (admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await execute(
      `UPDATE projects SET is_archived = TRUE, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    broadcast({ type: 'project:deleted', projectId: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    console.error('Project delete error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/members — add member
router.post('/:id/members', requireAdmin, async (req, res) => {
  try {
    const { user_id, role } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    await execute(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.params.id, user_id, role || 'member']
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Add member error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id/members/:userId — remove member
router.delete('/:id/members/:userId', requireAdmin, async (req, res) => {
  try {
    await execute(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
      [req.params.id, req.params.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove member error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
