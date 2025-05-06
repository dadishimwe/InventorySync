const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const csvWriter = require('csv-writer').createObjectCsvStringifier;
const app = express();
const db = new sqlite3.Database('./database.db');

app.use(express.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
}));

function runAsync(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID });
    });
  });
}

function allAsync(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initializeDatabase() {
  await runAsync(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    name TEXT,
    password TEXT,
    role TEXT,
    department TEXT,
    permissions TEXT
  )`);
  await runAsync(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    serialNumber TEXT,
    location TEXT,
    status TEXT,
    quantity INTEGER,
    assignedTo INTEGER,
    timestamp TEXT,
    FOREIGN KEY(assignedTo) REFERENCES users(id)
  )`);
  const adminExists = await allAsync('SELECT * FROM users WHERE username = ?', ['admin']);
  if (!adminExists.length) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await runAsync('INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, ?)', ['admin', 'Admin User', hashedPassword, 'admin']);
  }
}

initializeDatabase();

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = (await allAsync('SELECT * FROM users WHERE username = ?', [username]))[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.user = user;
    res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role, permissions: user.permissions } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/register', async (req, res) => {
  const { username, name, password, role, permissions } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await runAsync('INSERT INTO users (username, name, password, role, permissions) VALUES (?, ?, ?, ?, ?)',
      [username, name, hashedPassword, role, permissions]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/reset-password', async (req, res) => {
  const { username, newPassword } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await runAsync('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.post('/change-password', requireAuth, async (req, res) => {
  const { newPassword } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await runAsync('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.session.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/inventory', requireAuth, async (req, res) => {
  const { name, serialNumber, location, status, quantity, assignedTo } = req.body;
  const user = req.session.user;
  if (user.role !== 'staff' && user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runAsync(
      'INSERT INTO inventory (name, serialNumber, location, status, quantity, assignedTo, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, serialNumber, location, status, quantity, assignedTo || null, new Date().toISOString()]
    );
    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/inventory', requireAuth, async (req, res) => {
  const { status } = req.query;
  const user = req.session.user;
  try {
    let query = 'SELECT i.*, u.name AS assignedToName FROM inventory i LEFT JOIN users u ON i.assignedTo = u.id';
    let params = [];
    if (user.role === 'client') {
      query += ' WHERE i.assignedTo = ?';
      params.push(user.id);
    }
    if (status) {
      query += user.role === 'client' ? ' AND i.status = ?' : ' WHERE i.status = ?';
      params.push(status);
    }
    const items = await allAsync(query, params);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/inventory/assigned', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (user.role !== 'client') return res.status(403).json({ error: 'Unauthorized' });
  try {
    const items = await allAsync('SELECT * FROM inventory WHERE assignedTo = ?', [user.id]);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/inventory/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const item = (await allAsync('SELECT * FROM inventory WHERE id = ?', [id]))[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (req.session.user.role === 'client' && item.assignedTo !== req.session.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/inventory/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, serialNumber, location, status, quantity, assignedTo } = req.body;
  const user = req.session.user;
  try {
    const item = (await allAsync('SELECT * FROM inventory WHERE id = ?', [id]))[0];
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (user.role === 'client' && (item.assignedTo !== user.id || user.permissions !== 'read_write')) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (user.role !== 'client' && user.role !== 'staff' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    await runAsync(
      'UPDATE inventory SET name = ?, serialNumber = ?, location = ?, status = ?, quantity = ?, assignedTo = ?, timestamp = ? WHERE id = ?',
      [name || item.name, serialNumber || item.serialNumber, location || item.location, status || item.status, 
       quantity !== undefined ? quantity : item.quantity, assignedTo !== undefined ? assignedTo : item.assignedTo, 
       new Date().toISOString(), id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/inventory/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const user = req.session.user;
  if (user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  try {
    await runAsync('DELETE FROM inventory WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users', requireAuth, async (req, res) => {
  const { role } = req.query;
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  try {
    const query = role ? 'SELECT * FROM users WHERE role = ?' : 'SELECT * FROM users';
    const users = await allAsync(query, role ? [role] : []);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/users', requireAuth, async (req, res) => {
  const { username, name, password, role, permissions } = req.body;
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await runAsync('INSERT INTO users (username, name, password, role, permissions) VALUES (?, ?, ?, ?, ?)',
      [username, name, hashedPassword, role, permissions]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/users/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  try {
    await runAsync('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/reports/inventory', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
  try {
    const items = await allAsync('SELECT i.*, u.name AS assignedToName FROM inventory i LEFT JOIN users u ON i.assignedTo = u.id');
    const writer = csvWriter({
      header: [
        { id: 'id', title: 'ID' },
        { id: 'name', title: 'Name' },
        { id: 'serialNumber', title: 'Serial Number' },
        { id: 'location', title: 'Location' },
        { id: 'status', title: 'Status' },
        { id: 'quantity', title: 'Quantity' },
        { id: 'assignedToName', title: 'Assigned To' },
        { id: 'timestamp', title: 'Timestamp' }
      ]
    });
    const csv = writer.getHeaderString() + writer.stringifyRecords(items);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=inventory_report.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));