require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { WebSocketServer } = require('ws');
const PgStore = require('connect-pg-simple')(session);
const { pool, initDb } = require('./db');

const app = express();
const server = http.createServer(app);

const sessionParser = session({
  store: new PgStore({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(sessionParser);
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

const onlineUsers = new Map();

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user?.is_admin) return res.status(403).send('Forbidden');
  return next();
}

app.get('/', (req, res) => res.redirect(req.session.user ? '/chat' : '/login'));

app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1 AND is_active=true', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.render('login', { error: 'Invalid credentials' });
  }
  req.session.user = { id: user.id, email: user.email, first_name: user.first_name, is_admin: user.is_admin };
  res.redirect('/chat');
});

app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', async (req, res) => {
  const open = await pool.query("SELECT value FROM app_settings WHERE key='registration_open'");
  if (open.rows[0]?.value !== 'true') return res.render('register', { error: 'Registration is closed by admin.' });
  const { first_name, last_name, email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      'INSERT INTO users(first_name,last_name,email,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,email,first_name,is_admin',
      [first_name, last_name, email, hash]
    );
    req.session.user = result.rows[0];
    res.redirect('/chat');
  } catch (e) {
    res.render('register', { error: 'Email already exists.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/chat', requireAuth, (req, res) => res.render('chat', { user: req.session.user }));
app.get('/admin', requireAuth, requireAdmin, (req, res) => res.render('admin', { user: req.session.user }));

app.get('/api/me', requireAuth, (req, res) => res.json(req.session.user));
app.get('/api/settings', requireAuth, async (req, res) => {
  const q = await pool.query("SELECT value FROM app_settings WHERE key='registration_open'");
  res.json({ registration_open: q.rows[0]?.value === 'true' });
});

app.get('/api/conversations', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  const q = await pool.query(
    `SELECT c.id,c.name,c.is_group
     FROM conversations c
     JOIN conversation_members cm ON c.id=cm.conversation_id
     WHERE cm.user_id=$1
     ORDER BY c.created_at DESC`,
    [userId]
  );
  res.json(q.rows);
});

app.post('/api/conversations/direct/:targetId', requireAuth, async (req, res) => {
  const me = req.session.user.id;
  const other = Number(req.params.targetId);
  const existing = await pool.query(
    `SELECT c.id,c.name,c.is_group FROM conversations c
     JOIN conversation_members cm1 ON c.id=cm1.conversation_id AND cm1.user_id=$1
     JOIN conversation_members cm2 ON c.id=cm2.conversation_id AND cm2.user_id=$2
     WHERE c.is_group=false LIMIT 1`,
    [me, other]
  );
  if (existing.rows[0]) return res.json(existing.rows[0]);
  const c = await pool.query('INSERT INTO conversations(name,is_group,created_by) VALUES ($1,false,$2) RETURNING *', [`Direct ${me}-${other}`, me]);
  await pool.query('INSERT INTO conversation_members(conversation_id,user_id) VALUES ($1,$2),($1,$3)', [c.rows[0].id, me, other]);
  res.json(c.rows[0]);
});

app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  const conversationId = Number(req.params.id);
  const userId = req.session.user.id;
  const member = await pool.query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2', [conversationId, userId]);
  if (!member.rows.length && !req.session.user.is_admin) return res.status(403).json({ error: 'Forbidden' });
  const q = await pool.query(
    `SELECT m.id,m.conversation_id,m.body,m.created_at,m.reply_to_id,
            u.first_name,u.last_name,u.id AS sender_id,
            r.body AS reply_body
     FROM messages m
     LEFT JOIN users u ON u.id=m.sender_id
     LEFT JOIN messages r ON r.id=m.reply_to_id
     WHERE conversation_id=$1
     ORDER BY m.created_at ASC`,
    [conversationId]
  );
  res.json(q.rows);
});

app.get('/api/users', requireAuth, async (req, res) => {
  const q = req.session.user.is_admin
    ? await pool.query('SELECT id,first_name,last_name,email,is_admin,is_active,created_at FROM users ORDER BY id')
    : await pool.query('SELECT id,first_name,last_name,email,is_admin,is_active,created_at FROM users WHERE id != $1 ORDER BY id', [req.session.user.id]);
  res.json(q.rows);
});

app.post('/api/admin/groups', requireAuth, requireAdmin, async (req, res) => {
  const { name, memberIds = [] } = req.body;
  const creator = req.session.user.id;
  const c = await pool.query('INSERT INTO conversations(name,is_group,created_by) VALUES ($1,true,$2) RETURNING *', [name, creator]);
  const ids = [...new Set([creator, ...memberIds.map(Number)])];
  for (const uid of ids) {
    await pool.query('INSERT INTO conversation_members(conversation_id,user_id,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [c.rows[0].id, uid, uid === creator ? 'admin' : 'member']);
  }
  res.json(c.rows[0]);
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { first_name, last_name, email, password, is_admin } = req.body;
  const hash = await bcrypt.hash(password || '123456', 10);
  const q = await pool.query(
    'INSERT INTO users(first_name,last_name,email,password_hash,is_admin) VALUES ($1,$2,$3,$4,$5) RETURNING id,first_name,last_name,email,is_admin,is_active,created_at',
    [first_name, last_name, email, hash, !!is_admin]
  );
  res.json(q.rows[0]);
});

app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { first_name, last_name, is_admin, is_active } = req.body;
  const q = await pool.query(
    'UPDATE users SET first_name=$1,last_name=$2,is_admin=$3,is_active=$4 WHERE id=$5 RETURNING id,first_name,last_name,email,is_admin,is_active,created_at',
    [first_name, last_name, !!is_admin, !!is_active, id]
  );
  res.json(q.rows[0]);
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM users WHERE id=$1', [Number(req.params.id)]);
  res.json({ ok: true });
});

app.post('/api/admin/clear-db', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('TRUNCATE messages, conversation_members, conversations RESTART IDENTITY CASCADE');
  res.json({ ok: true });
});

app.post('/api/admin/registration', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('UPDATE app_settings SET value=$1 WHERE key=$2', [req.body.open ? 'true' : 'false', 'registration_open']);
  res.json({ ok: true });
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  sessionParser(request, {}, () => {
    if (!request.session?.user) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });
});

async function canAccessConversation(userId, conversationId) {
  const q = await pool.query('SELECT 1 FROM conversation_members WHERE user_id=$1 AND conversation_id=$2', [userId, conversationId]);
  return q.rows.length > 0;
}

wss.on('connection', (ws, request) => {
  const user = request.session.user;
  if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
  onlineUsers.get(user.id).add(ws);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'send_message') {
        const conversationId = Number(msg.conversationId);
        if (!(await canAccessConversation(user.id, conversationId))) return;
        const inserted = await pool.query(
          `INSERT INTO messages(conversation_id,sender_id,body,reply_to_id)
           VALUES ($1,$2,$3,$4)
           RETURNING id,conversation_id,body,created_at,reply_to_id`,
          [conversationId, user.id, msg.body, msg.replyToId || null]
        );
        const payload = {
          type: 'new_message',
          message: {
            ...inserted.rows[0],
            sender_id: user.id,
            first_name: user.first_name,
            last_name: ''
          }
        };
        const members = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id=$1', [conversationId]);
        members.rows.forEach(({ user_id }) => {
          (onlineUsers.get(user_id) || []).forEach((client) => {
            if (client.readyState === 1) client.send(JSON.stringify(payload));
          });
        });
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  ws.on('close', () => {
    const set = onlineUsers.get(user.id);
    if (!set) return;
    set.delete(ws);
    if (!set.size) onlineUsers.delete(user.id);
  });
});

(async () => {
  await initDb();
  const admin = await pool.query('SELECT 1 FROM users WHERE is_admin=true LIMIT 1');
  if (!admin.rows.length) {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(
      "INSERT INTO users(first_name,last_name,email,password_hash,is_admin) VALUES ('Admin','Root','admin@local.dev',$1,true)",
      [hash]
    );
  }
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(`Server running at http://localhost:${port}`));
})();
