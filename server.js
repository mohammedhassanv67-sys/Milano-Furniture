const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { initDatabase, run, get, all, saveDb } = require('./database/init');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ===== TRUST PROXY (for hosting platforms) =====
app.set('trust proxy', 1);

// ===== SECURITY HEADERS =====
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// ===== CORS =====
app.use(cors({
  origin: IS_PRODUCTION ? false : true,
  credentials: true
}));

// ===== BODY PARSERS =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ===== RATE LIMITING (Simple in-memory) =====
const rateLimitStore = {};

function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const key = ip + ':' + req.path;

    if (!rateLimitStore[key]) {
      rateLimitStore[key] = { count: 1, resetAt: now + windowMs };
      return next();
    }

    if (now > rateLimitStore[key].resetAt) {
      rateLimitStore[key] = { count: 1, resetAt: now + windowMs };
      return next();
    }

    rateLimitStore[key].count++;
    if (rateLimitStore[key].count > maxRequests) {
      return res.status(429).json({ error: 'تم تجاوز الحد المسموح. حاول مرة أخرى لاحقاً' });
    }
    next();
  };
}

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const key in rateLimitStore) {
    if (now > rateLimitStore[key].resetAt) {
      delete rateLimitStore[key];
    }
  }
}, 600000);

// ===== BLOCK SENSITIVE FILES =====
const blockedPaths = [
  '/server.js', '/package.json', '/package-lock.json',
  '/.git', '/.env', '/.env.local', '/.env.production',
  '/database/', '/node_modules/',
  '/views/', '/.gitignore', '/README.md'
];

app.use((req, res, next) => {
  const urlPath = decodeURIComponent(req.path).split('?')[0];

  for (const blocked of blockedPaths) {
    if (urlPath === blocked || urlPath.startsWith(blocked)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  // Block common attack paths
  const attackPatterns = [
    '/wp-admin', '/wp-login', '/phpmyadmin', '/admin.php',
    '/.env', '/config.php', '/xmlrpc.php', '/cgi-bin/',
    '/phpinfo', '/wp-content', '/wp-includes'
  ];
  for (const pattern of attackPatterns) {
    if (urlPath.toLowerCase().startsWith(pattern)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  next();
});

// ===== SESSION =====
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? 'strict' : 'lax'
  }
}));

// ===== MULTER STORAGE =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads')),
  filename: (req, file, cb) => {
    // Sanitize filename
    const cleanName = file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_');
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
    cb(null, uniqueSuffix + path.extname(cleanName));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedImage = /^image\/(jpeg|jpg|png|gif|webp|svg\+xml)$/i;
  const allowedVideo = /^video\/(mp4|webm|ogg|quicktime|avi)$/i;

  if (allowedImage.test(file.mimetype) || allowedVideo.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('نوع الملف غير مدعوم: ' + file.mimetype), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 }
});

// ===== STATIC FILES (with restrictions) =====
// Serve public static files BUT block script execution in uploads
app.use('/uploads', (req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  const blockedExts = ['.js', '.html', '.htm', '.php', '.phtml', '.asp', '.aspx', '.jsp', '.cgi', '.sh', '.bat', '.cmd', '.exe', '.ps1'];
  if (blockedExts.includes(ext)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}, express.static(path.join(__dirname, 'public/uploads'), {
  maxAge: IS_PRODUCTION ? '30d' : '0',
  immutable: IS_PRODUCTION
}));

// Serve other public files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PRODUCTION ? '7d' : '0',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ===== AUTH MIDDLEWARE =====
const requireAuth = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

const requireLogin = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  res.status(401).json({ error: 'يجب تسجيل الدخول أولاً' });
};

// ===== SANITIZE INPUT =====
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim();
}

function sanitizeBody(obj) {
  const cleaned = {};
  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      cleaned[key] = sanitize(obj[key]);
    } else {
      cleaned[key] = obj[key];
    }
  }
  return cleaned;
}

// ===== AUTH ROUTES =====
app.post('/api/auth/register', rateLimit(15 * 60 * 1000, 10), (req, res) => {
  const { username, password } = req.body;

  if (!username || username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: 'اسم المستخدم يجب أن يكون 3-30 حرف' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'اسم المستخدم يجب أن يحتوي على أحرف وأرقام فقط' });
  }

  if (!password || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8-128 حرف' });
  }

  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تحتوي على أحرف وأرقام' });
  }

  const existing = get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });
  }

  const hashedPassword = bcrypt.hashSync(password, 12);
  run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, 'user']);

  res.json({ success: true, message: 'تم إنشاء الحساب بنجاح' });
});

app.post('/api/auth/login', rateLimit(15 * 60 * 1000, 10), (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  const user = get('SELECT * FROM users WHERE username = ?', [username]);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }

  // Regenerate session to prevent session fixation
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ success: true, user: { username: user.username, role: user.role } });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

app.get('/api/auth/check-username/:username', (req, res) => {
  const username = req.params.username;
  if (!username || username.length < 3) {
    return res.json({ available: false });
  }
  const existing = get('SELECT id FROM users WHERE username = ?', [username]);
  res.json({ available: !existing });
});

// ===== USER ACCOUNT ROUTES =====
app.post('/api/account/change-password', requireLogin, rateLimit(60 * 60 * 1000, 10), (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);

  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  }

  if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 8-128 حرف' });
  }

  if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تحتوي على أحرف وأرقام' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة مختلفة عن الحالية' });
  }

  const hashedPassword = bcrypt.hashSync(newPassword, 12);
  run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id]);
  res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
});

app.post('/api/account/update', requireLogin, (req, res) => {
  const { username } = req.body;

  if (!username || username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: 'اسم المستخدم يجب أن يكون 3-30 حرف' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'اسم المستخدم يجب أن يحتوي على أحرف وأرقام فقط' });
  }

  const existing = get('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.session.user.id]);
  if (existing) {
    return res.status(400).json({ error: 'اسم المستخدم مستخدم بالفعل' });
  }

  run('UPDATE users SET username = ? WHERE id = ?', [username, req.session.user.id]);
  req.session.user.username = username;
  res.json({ success: true, message: 'تم تحديث الحساب بنجاح' });
});

// ===== PRODUCTS ROUTES =====
app.get('/api/products', (req, res) => {
  const { category, available, search, minPrice, maxPrice } = req.query;
  let query = 'SELECT * FROM products';
  const params = [];
  const conditions = [];

  if (category && ['salon', 'bedroom', 'dining', 'lshape', 'other'].includes(category)) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (available !== undefined) {
    conditions.push('is_available = ?');
    params.push(available === 'true' ? 1 : 0);
  }
  if (search && search.length <= 100) {
    conditions.push('(name LIKE ? OR description LIKE ?)');
    params.push('%' + search + '%', '%' + search + '%');
  }
  if (minPrice && !isNaN(parseFloat(minPrice))) {
    conditions.push('price >= ?');
    params.push(parseFloat(minPrice));
  }
  if (maxPrice && !isNaN(parseFloat(maxPrice))) {
    conditions.push('price <= ?');
    params.push(parseFloat(maxPrice));
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY created_at DESC';

  const products = all(query, params);
  res.json(products);
});

app.get('/api/products/stats/counts', requireAuth, (req, res) => {
  const total = get('SELECT COUNT(*) as count FROM products');
  const available = get('SELECT COUNT(*) as count FROM products WHERE is_available = 1');
  const categories = get('SELECT COUNT(DISTINCT category) as count FROM products');
  res.json({
    total: total.count,
    available: available.count,
    categories: categories.count
  });
});

app.get('/api/products/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }
  const product = get('SELECT * FROM products WHERE id = ?', [id]);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.post('/api/products', requireAuth, (req, res) => {
  const { name, description, price, images, video_url, category, is_available } = req.body;
  const imagesJson = JSON.stringify(images || []);
  run('INSERT INTO products (name, description, price, images, video_url, category, is_available) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sanitize(name), sanitize(description), parseFloat(price) || 0, imagesJson, video_url || null, category || 'other', is_available !== undefined ? is_available : 1]);
  const last = get('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: last.id });
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }
  const { name, description, price, images, video_url, category, is_available } = req.body;
  const imagesJson = JSON.stringify(images || []);
  run('UPDATE products SET name = ?, description = ?, price = ?, images = ?, video_url = ?, category = ?, is_available = ? WHERE id = ?',
    [sanitize(name), sanitize(description), parseFloat(price) || 0, imagesJson, video_url || null, category || 'other', is_available, id]);
  res.json({ success: true });
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }
  run('DELETE FROM products WHERE id = ?', [id]);
  res.json({ success: true });
});

// ===== HERO ROUTES =====
app.get('/api/hero', (req, res) => {
  const hero = get('SELECT * FROM hero_settings WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
  res.json(hero || {});
});

app.get('/api/hero/all', requireAuth, (req, res) => {
  const heroes = all('SELECT * FROM hero_settings ORDER BY id DESC');
  res.json(heroes);
});

app.put('/api/hero/:id', requireAuth, (req, res) => {
  const { title, subtitle, background_image, logo_url, is_active } = req.body;
  run('UPDATE hero_settings SET title = ?, subtitle = ?, background_image = ?, logo_url = ?, is_active = ? WHERE id = ?',
    [sanitize(title), sanitize(subtitle), background_image, logo_url, is_active, parseInt(req.params.id)]);
  res.json({ success: true });
});

app.post('/api/hero', requireAuth, (req, res) => {
  const { title, subtitle, background_image, logo_url } = req.body;
  run('INSERT INTO hero_settings (title, subtitle, background_image, logo_url) VALUES (?, ?, ?, ?)',
    [sanitize(title), sanitize(subtitle), background_image, logo_url]);
  const last = get('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: last.id });
});

// ===== HERO SLIDES ROUTES =====
app.get('/api/slides', (req, res) => {
  const slides = all('SELECT * FROM hero_slides WHERE is_active = 1 ORDER BY sort_order ASC');
  res.json(slides);
});

app.get('/api/slides/all', requireAuth, (req, res) => {
  const slides = all('SELECT * FROM hero_slides ORDER BY sort_order ASC');
  res.json(slides);
});

app.post('/api/slides', requireAuth, (req, res) => {
  const { title, subtitle, image_url, btn_text, btn_link, sort_order } = req.body;
  run('INSERT INTO hero_slides (title, subtitle, image_url, btn_text, btn_link, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    [sanitize(title), sanitize(subtitle), image_url, sanitize(btn_text), btn_link, sort_order || 0]);
  const last = get('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: last.id });
});

app.put('/api/slides/:id', requireAuth, (req, res) => {
  const { title, subtitle, image_url, btn_text, btn_link, sort_order, is_active } = req.body;
  run('UPDATE hero_slides SET title = ?, subtitle = ?, image_url = ?, btn_text = ?, btn_link = ?, sort_order = ?, is_active = ? WHERE id = ?',
    [sanitize(title), sanitize(subtitle), image_url, sanitize(btn_text), btn_link, sort_order, is_active, parseInt(req.params.id)]);
  res.json({ success: true });
});

app.delete('/api/slides/:id', requireAuth, (req, res) => {
  run('DELETE FROM hero_slides WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ success: true });
});

// ===== CONTACT ROUTES =====
app.get('/api/contact', (req, res) => {
  const contact = get('SELECT * FROM contact_info ORDER BY id DESC LIMIT 1');
  res.json(contact || {});
});

app.put('/api/contact', requireAuth, (req, res) => {
  const { phone, email, address, map_embed_url, working_hours, facebook, instagram, tiktok, whatsapp } = req.body;
  const existing = get('SELECT id FROM contact_info ORDER BY id DESC LIMIT 1');
  if (existing) {
    run('UPDATE contact_info SET phone = ?, email = ?, address = ?, map_embed_url = ?, working_hours = ?, facebook = ?, instagram = ?, tiktok = ?, whatsapp = ? WHERE id = ?',
      [sanitize(phone), sanitize(email), sanitize(address), map_embed_url, sanitize(working_hours), facebook || null, instagram || null, tiktok || null, whatsapp || null, existing.id]);
  } else {
    run('INSERT INTO contact_info (phone, email, address, map_embed_url, working_hours, facebook, instagram, tiktok, whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [sanitize(phone), sanitize(email), sanitize(address), map_embed_url, sanitize(working_hours), facebook || null, instagram || null, tiktok || null, whatsapp || null]);
  }
  res.json({ success: true });
});

// ===== MESSAGES ROUTES =====
app.post('/api/messages', rateLimit(60 * 60 * 1000, 20), (req, res) => {
  const { name, email, phone, subject, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'الاسم والإيميل والرسالة مطلوبة' });
  }

  if (name.length > 100 || email.length > 200 || (message && message.length > 5000)) {
    return res.status(400).json({ error: 'البيانات طويلة جداً' });
  }

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح' });
  }

  const userId = req.session && req.session.user ? req.session.user.id : null;

  run('INSERT INTO messages (user_id, name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, sanitize(name), sanitize(email), sanitize(phone), sanitize(subject), sanitize(message)]);

  const last = get('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: last.id, message: 'تم إرسال رسالتك بنجاح' });
});

app.get('/api/messages', requireAuth, (req, res) => {
  const messages = all('SELECT * FROM messages ORDER BY created_at DESC');
  res.json(messages);
});

app.get('/api/messages/unread', requireAuth, (req, res) => {
  const count = get('SELECT COUNT(*) as count FROM messages WHERE is_read = 0');
  res.json({ count: count.count });
});

app.put('/api/messages/:id/read', requireAuth, (req, res) => {
  run('UPDATE messages SET is_read = 1 WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ success: true });
});

app.put('/api/messages/:id/reply', requireAuth, (req, res) => {
  const { reply } = req.body;
  run('UPDATE messages SET reply = ? WHERE id = ?', [sanitize(reply), parseInt(req.params.id)]);
  res.json({ success: true });
});

app.delete('/api/messages/:id', requireAuth, (req, res) => {
  run('DELETE FROM messages WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ success: true });
});

// ===== USERS MANAGEMENT (Admin) =====
app.get('/api/users', requireAuth, (req, res) => {
  const users = all('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
  res.json(users);
});

app.put('/api/users/:id/role', requireAuth, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  run('UPDATE users SET role = ? WHERE id = ?', [role, parseInt(req.params.id)]);
  res.json({ success: true });
});

app.delete('/api/users/:id', requireAuth, (req, res) => {
  const user = get('SELECT id, username FROM users WHERE id = ?', [parseInt(req.params.id)]);
  if (user && user.username === 'admin') {
    return res.status(400).json({ error: 'لا يمكن حذف الأدمن الرئيسي' });
  }
  run('DELETE FROM users WHERE id = ?', [parseInt(req.params.id)]);
  res.json({ success: true });
});

app.put('/api/users/:id/password', requireAuth, rateLimit(60 * 60 * 1000, 20), (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8-128 حرف' });
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تحتوي على أحرف وأرقام' });
  }
  const hashedPassword = bcrypt.hashSync(password, 12);
  run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, parseInt(req.params.id)]);
  res.json({ success: true });
});

// ===== UPLOAD ROUTES =====
app.post('/api/upload', requireAuth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'الملف كبير جداً. الحد الأقصى 200 ميجابايت' });
      }
      return res.status(400).json({ error: err.message || 'خطأ في رفع الملف' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, url: '/uploads/' + req.file.filename });
  });
});

app.post('/api/upload/video', requireAuth, (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'الملف كبير جداً. الحد الأقصى 200 ميجابايت' });
      }
      return res.status(400).json({ error: err.message || 'خطأ في رفع الملف' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, url: '/uploads/' + req.file.filename });
  });
});

// ===== QR CODE ROUTE =====
app.get('/api/qr/:productId', async (req, res) => {
  try {
    const id = parseInt(req.params.productId);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid product ID' });
    }
    const product = get('SELECT * FROM products WHERE id = ?', [id]);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const host = req.get('host') || req.hostname + ':' + PORT;
    const productUrl = `${req.protocol}://${host}/product.html?id=${product.id}`;
    const qrDataUrl = await QRCode.toDataURL(productUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    res.json({ success: true, qr: qrDataUrl, url: productUrl });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// ===== PAGE ROUTES =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/account', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views', 'account.html')));
app.get('/settings', requireLogin, (req, res) => res.sendFile(path.join(__dirname, 'views', 'settings.html')));
app.get('/product.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'product.html')));

// Admin routes (all protected)
app.get('/admin', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'dashboard.html')));
app.get('/admin/products', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'products.html')));
app.get('/admin/products/add', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'add-product.html')));
app.get('/admin/products/edit/:id', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'edit-product.html')));
app.get('/admin/hero', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'hero.html')));
app.get('/admin/contact', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'contact.html')));
app.get('/admin/messages', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'messages.html')));
app.get('/admin/users', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin', 'users.html')));

// ===== 404 HANDLER =====
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'views', 'index.html'));
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
  res.status(500).send('<h1 style="text-align:center;padding:50px;font-family:sans-serif;">حدث خطأ في الخادم</h1>');
});

// ===== START SERVER =====
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name in interfaces) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address);
        }
      }
    }

    console.log('\n========================================');
    console.log('  Milano Furniture Server');
    console.log('========================================');
    console.log(`  Local:    http://localhost:${PORT}`);
    ips.forEach(ip => console.log(`  Network:  http://${ip}:${PORT}`));
    console.log(`  Admin:    http://localhost:${PORT}/admin`);
    console.log(`  Login:    admin / admin123`);
    console.log(`  Env:      ${IS_PRODUCTION ? 'Production' : 'Development'}`);
    console.log('========================================\n');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
