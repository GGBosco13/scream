/**
 * Authentication Routes
 *
 * POST /api/auth/login       – Staff login
 * POST /api/auth/admin       – Admin create/disable staff account
 * GET  /api/auth/staff-list  – List all staff (admin only)
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

// In-memory staff store (demo; use DB in production)
const staffStore = new Map();

function initDefaultAdmin() {
  const adminId = process.env.ADMIN_EMPLOYEE_ID || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123temp';
  const salt = bcrypt.genSaltSync(10);
  staffStore.set(adminId, {
    employeeId: adminId,
    passwordHash: bcrypt.hashSync(adminPass, salt),
    role: 'admin',
    active: true,
    createdAt: Date.now(),
  });
}

initDefaultAdmin();

/**
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
  const { employeeId, password } = req.body;
  if (!employeeId || !password) {
    return res.status(400).json({ error: 'Employee ID and password required' });
  }
  const staff = staffStore.get(employeeId);
  if (!staff || !staff.active) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!bcrypt.compareSync(password, staff.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({
    success: true,
    staffId: staff.employeeId,
    role: staff.role,
    message: 'Login successful',
  });
});

/**
 * POST /api/auth/admin/create
 */
router.post('/admin/create', (req, res) => {
  const { employeeId, password, role } = req.body;
  if (!employeeId || !password) {
    return res.status(400).json({ error: 'Employee ID and password required' });
  }
  const salt = bcrypt.genSaltSync(10);
  staffStore.set(employeeId, {
    employeeId,
    passwordHash: bcrypt.hashSync(password, salt),
    role: role || 'staff',
    active: true,
    createdAt: Date.now(),
  });
  console.log(`[Auth] New staff: ${employeeId}`);
  res.json({
    success: true,
    employeeId,
    role: role || 'staff',
    temporaryPassword: password,
    message: 'Staff account created',
  });
});

/**
 * POST /api/auth/admin/disable
 */
router.post('/admin/disable', (req, res) => {
  const { employeeId } = req.body;
  const staff = staffStore.get(employeeId);
  if (!staff) {
    return res.status(404).json({ error: 'Staff not found' });
  }
  if (staff.role === 'admin') {
    return res.status(403).json({ error: 'Cannot disable admin account' });
  }
  staff.active = false;
  res.json({ success: true, message: `Account for ${employeeId} disabled` });
});

/**
 * POST /api/auth/admin/reset
 */
router.post('/admin/reset', (req, res) => {
  const { employeeId, newPassword } = req.body;
  if (!employeeId || !newPassword) {
    return res.status(400).json({ error: 'Employee ID and new password required' });
  }
  const staff = staffStore.get(employeeId);
  if (!staff) {
    return res.status(404).json({ error: 'Staff not found' });
  }
  const salt = bcrypt.genSaltSync(10);
  staff.passwordHash = bcrypt.hashSync(newPassword, salt);
  res.json({ success: true, message: 'Password reset successfully' });
});

/**
 * GET /api/auth/staff-list
 */
router.get('/staff-list', (_req, res) => {
  const staffList = [];
  for (const [id, data] of staffStore) {
    staffList.push({
      employeeId: id,
      role: data.role,
      active: data.active,
      createdAt: data.createdAt,
    });
  }
  res.json({ staffList });
});

module.exports = router;
