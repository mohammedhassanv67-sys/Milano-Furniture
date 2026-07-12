const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'milano.db');

let db = null;

function saveDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    images TEXT DEFAULT '[]',
    video_url TEXT,
    category TEXT DEFAULT 'general',
    is_available INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  run(`CREATE TABLE IF NOT EXISTS hero_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT 'Milano Furniture',
    subtitle TEXT DEFAULT 'أثاث فاخر يعكس ذوقك الرفيع',
    background_image TEXT,
    logo_url TEXT,
    is_active INTEGER DEFAULT 1
  )`);

  run(`CREATE TABLE IF NOT EXISTS contact_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    email TEXT,
    address TEXT,
    map_embed_url TEXT,
    working_hours TEXT,
    facebook TEXT,
    instagram TEXT,
    tiktok TEXT,
    whatsapp TEXT
  )`);

  run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    reply TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  run(`CREATE TABLE IF NOT EXISTS hero_slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    subtitle TEXT,
    image_url TEXT,
    btn_text TEXT,
    btn_link TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1
  )`);

  run(`CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  const existingAdmin = get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!existingAdmin) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', hashedPassword, 'admin']);
  }

  const existingHero = get('SELECT id FROM hero_settings WHERE id = 1');
  if (!existingHero) {
    run('INSERT INTO hero_settings (title, subtitle) VALUES (?, ?)', ['Milano Furniture', 'أثاث فاخر يعكس ذوقك الرفيع']);
  }

  const existingContact = get('SELECT id FROM contact_info WHERE id = 1');
  if (!existingContact) {
    run('INSERT INTO contact_info (phone, email, address, working_hours) VALUES (?, ?, ?, ?)', ['+966 50 123 4567', 'info@milano-furniture.com', 'الرياض، المملكة العربية السعودية', 'السبت - الخميس: 9 صباحاً - 10 مساءً']);
  }

  const existingSlides = get('SELECT id FROM hero_slides LIMIT 1');
  if (!existingSlides) {
    run('INSERT INTO hero_slides (title, subtitle, image_url, btn_text, btn_link, sort_order) VALUES (?, ?, ?, ?, ?, ?)', 
      ['Milano Furniture', 'أثاث فاخر يعكس ذوقك الرفيع', '/images/hero/hero1.jpg', 'اكتشف المعرض', '#gallery', 1]);
    run('INSERT INTO hero_slides (title, subtitle, image_url, btn_text, btn_link, sort_order) VALUES (?, ?, ?, ?, ?, ?)', 
      ['تشكيلة فريدة', 'أجواء فخمة لمنزلك', '/images/hero/hero2.jpg', 'تصفح المنتجات', '#gallery', 2]);
  }

  const defaultSettings = {
    'hero_title': 'Milano Furniture',
    'hero_subtitle': 'أثاث فاخر يعكس ذوقك الرفيع',
    'hero_logo': '',
    'hero_btn_text': 'اكتشف المعرض',
    'hero_btn_link': '#gallery',
    'counter_products_value': '150',
    'counter_products_label': 'منتج متوفر',
    'counter_customers_value': '500',
    'counter_customers_label': 'عميل سعيد',
    'counter_years_value': '10',
    'counter_years_label': 'سنوات خبرة',
    'counter_cities_value': '25',
    'counter_cities_label': 'مدينة',
    'hero_tag_1_text': 'جودة عالية',
    'hero_tag_1_icon': 'fa-gem',
    'hero_tag_2_text': 'توصيل مجاني',
    'hero_tag_2_icon': 'fa-truck',
    'hero_tag_3_text': 'ضمان سنة',
    'hero_tag_3_icon': 'fa-shield-alt',
    'typing_phrase_1': 'أثاث فاخر يعكس ذوقك الرفيع',
    'typing_phrase_2': 'تشكيلة فريدة من أرقى الماركات',
    'typing_phrase_3': 'تصميم عصري بلمسة كلاسيكية',
    'typing_phrase_4': 'جودة لا تُضاهى بأفضل الأسعار'
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    const existing = get('SELECT key FROM site_settings WHERE key = ?', [key]);
    if (!existing) {
      run('INSERT INTO site_settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }

  // Migration: copy hero_settings title to site_settings if hero_settings has data
  try {
    const heroRow = get('SELECT title, subtitle, logo_url FROM hero_settings WHERE id = 1');
    if (heroRow) {
      const titleSetting = get('SELECT key FROM site_settings WHERE key = ?', ['hero_title']);
      if (titleSetting && titleSetting.value === 'Milano Furniture' && heroRow.title && heroRow.title !== 'Milano Furniture') {
        run('UPDATE site_settings SET value = ? WHERE key = ?', [heroRow.title, 'hero_title']);
      }
      if (heroRow.subtitle) {
        const subSetting = get('SELECT value FROM site_settings WHERE key = ?', ['hero_subtitle']);
        if (subSetting && subSetting.value === 'أثاث فاخر يعكس ذوقك الرفيع' && heroRow.subtitle !== 'أثاث فاخر يعكس ذوقك الرفيع') {
          run('UPDATE site_settings SET value = ? WHERE key = ?', [heroRow.subtitle, 'hero_subtitle']);
        }
      }
      if (heroRow.logo_url) {
        const logoSetting = get('SELECT key FROM site_settings WHERE key = ?', ['hero_logo']);
        if (logoSetting && !logoSetting.value) {
          run('UPDATE site_settings SET value = ? WHERE key = ?', [heroRow.logo_url, 'hero_logo']);
        }
      }
    }
  } catch (e) {}

  // Migration: ensure images/video_url columns exist for older DBs
  try {
    const cols = all("PRAGMA table_info(products)");
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('images')) {
      run("ALTER TABLE products ADD COLUMN images TEXT DEFAULT '[]'");
    }
    if (!colNames.includes('video_url')) {
      run("ALTER TABLE products ADD COLUMN video_url TEXT");
    }
  } catch (e) {}

  // Migration: add social columns to contact_info
  try {
    const cols = all("PRAGMA table_info(contact_info)");
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('facebook')) run("ALTER TABLE contact_info ADD COLUMN facebook TEXT");
    if (!colNames.includes('instagram')) run("ALTER TABLE contact_info ADD COLUMN instagram TEXT");
    if (!colNames.includes('tiktok')) run("ALTER TABLE contact_info ADD COLUMN tiktok TEXT");
    if (!colNames.includes('whatsapp')) run("ALTER TABLE contact_info ADD COLUMN whatsapp TEXT");
  } catch (e) {}

  saveDb();
  console.log('Database initialized successfully');
}

module.exports = { initDatabase, run, get, all, saveDb, dbPath };
