const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

let client = null;
let sqlDb = null;
let dbPath = null;
let useTurso = false;

function saveDb() {
  if (useTurso || !sqlDb) return;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = sqlDb.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

async function initDatabase() {
  if (TURSO_URL) {
    const { createClient } = require('@libsql/client');
    client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined });
    useTurso = true;
    await client.execute('SELECT 1');
    console.log('Database connected: Turso');
  } else {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    dbPath = process.env.DB_PATH || path.join(__dirname, 'milano.db');
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      sqlDb = new SQL.Database(fileBuffer);
    } else {
      sqlDb = new SQL.Database();
    }
    console.log('Database connected: Local (' + dbPath + ')');
  }

  await batch([
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      images TEXT DEFAULT '[]',
      video_url TEXT,
      category TEXT DEFAULT 'general',
      is_available INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS hero_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT 'Milano Furniture',
      subtitle TEXT DEFAULT 'أثاث فاخر يعكس ذوقك الرفيع',
      background_image TEXT,
      logo_url TEXT,
      is_active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS contact_info (
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
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
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
    )`,
    `CREATE TABLE IF NOT EXISTS hero_slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      subtitle TEXT,
      image_url TEXT,
      btn_text TEXT,
      btn_link TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )`
  ]);

  const existingAdmin = await get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!existingAdmin) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    await run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', hashedPassword, 'admin']);
  }

  const existingHero = await get('SELECT id FROM hero_settings WHERE id = 1');
  if (!existingHero) {
    await run('INSERT INTO hero_settings (title, subtitle) VALUES (?, ?)', ['Milano Furniture', 'أثاث فاخر يعكس ذوقك الرفيع']);
  }

  const existingContact = await get('SELECT id FROM contact_info WHERE id = 1');
  if (!existingContact) {
    await run('INSERT INTO contact_info (phone, email, address, working_hours) VALUES (?, ?, ?, ?)',
      ['+966 50 123 4567', 'info@milano-furniture.com', 'الرياض، المملكة العربية السعودية', 'السبت - الخميس: 9 صباحاً - 10 مساءً']);
  }

  const existingSlides = await get('SELECT id FROM hero_slides LIMIT 1');
  if (!existingSlides) {
    await run('INSERT INTO hero_slides (title, subtitle, image_url, btn_text, btn_link, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      ['Milano Furniture', 'أثاث فاخر يعكس ذوقك الرفيع', '/images/hero/hero1.jpg', 'اكتشف المعرض', '#gallery', 1]);
    await run('INSERT INTO hero_slides (title, subtitle, image_url, btn_text, btn_link, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
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
    const existing = await get('SELECT key FROM site_settings WHERE key = ?', [key]);
    if (!existing) {
      await run('INSERT INTO site_settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }

  try {
    const heroRow = await get('SELECT title, subtitle, logo_url FROM hero_settings WHERE id = 1');
    if (heroRow) {
      const titleSetting = await get('SELECT key, value FROM site_settings WHERE key = ?', ['hero_title']);
      if (titleSetting && titleSetting.value === 'Milano Furniture' && heroRow.title && heroRow.title !== 'Milano Furniture') {
        await run('UPDATE site_settings SET value = ? WHERE key = ?', [heroRow.title, 'hero_title']);
      }
      if (heroRow.subtitle) {
        const subSetting = await get('SELECT value FROM site_settings WHERE key = ?', ['hero_subtitle']);
        if (subSetting && subSetting.value === 'أثاث فاخر يعكس ذوقك الرفيع' && heroRow.subtitle !== 'أثاث فاخر يعكس ذوقك الرفيع') {
          await run('UPDATE site_settings SET value = ? WHERE key = ?', [heroRow.subtitle, 'hero_subtitle']);
        }
      }
      if (heroRow.logo_url) {
        const logoSetting = await get('SELECT key FROM site_settings WHERE key = ?', ['hero_logo']);
        if (logoSetting && !logoSetting.value) {
          await run('UPDATE site_settings SET value = ? WHERE key = ?', [heroRow.logo_url, 'hero_logo']);
        }
      }
    }
  } catch (e) {}

  console.log('Database initialized successfully');
}

async function run(sql, params = []) {
  if (useTurso) {
    await client.execute({ sql, args: params || [] });
  } else {
    sqlDb.run(sql, params || []);
    saveDb();
  }
}

async function get(sql, params = []) {
  if (useTurso) {
    const result = await client.execute({ sql, args: params || [] });
    return result.rows[0] || undefined;
  } else {
    const stmt = sqlDb.prepare(sql);
    stmt.bind(params || []);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }
}

async function all(sql, params = []) {
  if (useTurso) {
    const result = await client.execute({ sql, args: params || [] });
    return result.rows;
  } else {
    const stmt = sqlDb.prepare(sql);
    stmt.bind(params || []);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
}

async function batch(statements) {
  if (useTurso) {
    await client.batch(statements);
  } else {
    for (const sql of statements) {
      sqlDb.run(sql);
    }
    saveDb();
  }
}

function getDbPath() {
  return dbPath;
}

module.exports = { initDatabase, run, get, all, getDbPath };
