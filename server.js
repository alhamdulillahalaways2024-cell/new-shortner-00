const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret';

app.set('trust proxy', 1);

// ===== DOMAIN CONFIG =====
const BASE_URL = (process.env.BASE_URL || 'https://thispersonisbrandshortner.com').replace(/\/$/, '');
const BASE_HOST = new URL(BASE_URL).hostname.toLowerCase();
const CUSTOM_DOMAINS = [
  process.env.DOMAIN_1, process.env.DOMAIN_2, process.env.DOMAIN_3,
  process.env.DOMAIN_4, process.env.DOMAIN_5, process.env.DOMAIN_6,
  process.env.DOMAIN_7, process.env.DOMAIN_8, process.env.DOMAIN_9, process.env.DOMAIN_10
].filter(Boolean)
  .map(d => String(d).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase())
  .filter((d, i, arr) => d && d !== BASE_HOST && arr.indexOf(d) === i);
const AVAILABLE_DOMAINS = [BASE_HOST, ...CUSTOM_DOMAINS];
const PREVIEW_DESCRIPTION = process.env.PREVIEW_DESCRIPTION || 'Fast, clean and secure short links powered by THIS PERSON IS BRAND.';

// ===== VIEW ENGINE / STATIC =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ===== MIDDLEWARE =====
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// ===== POSTGRESQL: APP DATA + SESSIONS =====
const dbUrl = (process.env.DATABASE_URL || '').trim();
if (!dbUrl) {
  console.error('❌ DATABASE_URL is required for V6 Full PostgreSQL.');
  console.error('Set DATABASE_URL in the Railway website service, then redeploy.');
  process.exit(1);
}
const isRailwayInternal = /\.railway\.internal(?::\d+)?\//i.test(dbUrl);
const pool = new Pool({
  connectionString: dbUrl,
  ssl: isRailwayInternal ? false : { rejectUnauthorized: false },
  max: 12,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
pool.on('error', err => console.error('PostgreSQL pool error:', err.message));

const sessionStore = new pgSession({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: true,
  pruneSessionInterval: 60 * 15,
  errorLog: err => console.error('PostgreSQL session store error:', err)
});

app.use(session({
  store: sessionStore,
  proxy: true,
  name: 'tpib.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      profile_photo TEXT NOT NULL DEFAULT '',
      timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
      account_status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      total_links INTEGER NOT NULL DEFAULT 0,
      total_clicks BIGINT NOT NULL DEFAULT 0,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS links (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      selected_domain TEXT NOT NULL,
      original_url TEXT NOT NULL,
      short_code TEXT NOT NULL,
      custom_slug TEXT,
      title TEXT NOT NULL DEFAULT '',
      clicks BIGINT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_expired BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(selected_domain, short_code)
    );

    CREATE TABLE IF NOT EXISTS clicks (
      id BIGSERIAL PRIMARY KEY,
      link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT 'Unknown',
      browser TEXT NOT NULL DEFAULT 'Unknown',
      os TEXT NOT NULL DEFAULT 'Unknown',
      country TEXT NOT NULL DEFAULT 'Unknown',
      country_code TEXT NOT NULL DEFAULT 'XX',
      city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      referrer TEXT NOT NULL DEFAULT '',
      is_bot BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS online_users (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id);
    CREATE INDEX IF NOT EXISTS idx_links_domain_code ON links(selected_domain, short_code);
    CREATE INDEX IF NOT EXISTS idx_clicks_user_id ON clicks(user_id);
    CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id);
    CREATE INDEX IF NOT EXISTS idx_clicks_created_at ON clicks(created_at);
    CREATE INDEX IF NOT EXISTS idx_online_last_seen ON online_users(last_seen);
  `);
  console.log('✅ Full app database tables ready: users, links, clicks, online_users');
}

function toIso(v) { return v ? new Date(v).toISOString() : null; }
function mapUser(r) {
  if (!r) return null;
  return {
    id: Number(r.id), telegramId: r.telegram_id, username: r.username,
    firstName: r.first_name, lastName: r.last_name, displayName: r.display_name,
    email: r.email, profilePhoto: r.profile_photo, timezone: r.timezone,
    accountStatus: r.account_status, createdAt: toIso(r.created_at), lastLogin: toIso(r.last_login),
    totalLinks: Number(r.total_links || 0), totalClicks: Number(r.total_clicks || 0), isAdmin: !!r.is_admin
  };
}
function mapLink(r) {
  if (!r) return null;
  return {
    id: Number(r.id), userId: Number(r.user_id), selectedDomain: r.selected_domain,
    originalUrl: r.original_url, shortCode: r.short_code, customSlug: r.custom_slug,
    title: r.title || '', clicks: Number(r.clicks || 0), isActive: !!r.is_active,
    isExpired: !!r.is_expired, expiresAt: toIso(r.expires_at), createdAt: toIso(r.created_at), updatedAt: toIso(r.updated_at)
  };
}
function mapClick(r) {
  return {
    id: Number(r.id), linkId: Number(r.link_id), userId: Number(r.user_id), ipAddress: r.ip_address,
    userAgent: r.user_agent, device: r.device, browser: r.browser, os: r.os,
    country: r.country, countryCode: r.country_code, city: r.city, region: r.region,
    referrer: r.referrer, isBot: !!r.is_bot, createdAt: toIso(r.created_at)
  };
}
function mapOnline(r) {
  return { id: Number(r.user_id), username: r.username, displayName: r.display_name, lastSeen: new Date(r.last_seen).getTime() };
}

async function migrateLegacyJsonIfPossible() {
  const legacyPath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(legacyPath)) return;
  try {
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    if (Number(count.rows[0].count) > 0) return;
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    if (!legacy || !Array.isArray(legacy.users) || legacy.users.length === 0) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const u of legacy.users) {
        await client.query(`INSERT INTO users
          (id, telegram_id, username, first_name, last_name, display_name, email, profile_photo, timezone, account_status, created_at, last_login, total_links, total_clicks, is_admin)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (telegram_id) DO NOTHING`,
          [u.id, String(u.telegramId || u.id), u.username||'', u.firstName||'', u.lastName||'', u.displayName||'', u.email||'', u.profilePhoto||'', u.timezone||'Asia/Dhaka', u.accountStatus||'active', u.createdAt||new Date(), u.lastLogin||new Date(), u.totalLinks||0, u.totalClicks||0, !!u.isAdmin]);
      }
      for (const l of (legacy.links || [])) {
        await client.query(`INSERT INTO links
          (id,user_id,selected_domain,original_url,short_code,custom_slug,title,clicks,is_active,is_expired,expires_at,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
          [l.id,l.userId,normalizeHost(l.selectedDomain||BASE_HOST),l.originalUrl,l.shortCode,l.customSlug||null,l.title||'',l.clicks||0,l.isActive!==false,!!l.isExpired,l.expiresAt||null,l.createdAt||new Date(),l.updatedAt||new Date()]);
      }
      for (const c of (legacy.clicks || [])) {
        await client.query(`INSERT INTO clicks
          (id,link_id,user_id,ip_address,user_agent,device,browser,os,country,country_code,city,region,referrer,is_bot,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
          [c.id,c.linkId,c.userId,c.ipAddress||'',c.userAgent||'',c.device||'Unknown',c.browser||'Unknown',c.os||'Unknown',c.country||'Unknown',c.countryCode||'XX',c.city||'',c.region||'',c.referrer||'',!!c.isBot,c.createdAt||new Date()]);
      }
      await client.query("SELECT setval(pg_get_serial_sequence('users','id'), COALESCE((SELECT MAX(id) FROM users),1), true)");
      await client.query("SELECT setval(pg_get_serial_sequence('links','id'), COALESCE((SELECT MAX(id) FROM links),1), true)");
      await client.query("SELECT setval(pg_get_serial_sequence('clicks','id'), COALESCE((SELECT MAX(id) FROM clicks),1), true)");
      await client.query('COMMIT');
      console.log(`✅ Legacy data.json migrated to PostgreSQL (${legacy.users.length} users)`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('Legacy migration skipped/failed:', e.message);
    } finally { client.release(); }
  } catch (e) { console.error('Legacy migration check failed:', e.message); }
}

// ===== COUNTRY DATA =====
// Keep the familiar country names/flags from the previous version, but also
// support any ISO-3166 alpha-2 code returned by geoip-lite.
const knownCountries = {
  BD:{name:'Bangladesh',flag:'🇧🇩'},IN:{name:'India',flag:'🇮🇳'},US:{name:'United States',flag:'🇺🇸'},GB:{name:'United Kingdom',flag:'🇬🇧'},DE:{name:'Germany',flag:'🇩🇪'},FR:{name:'France',flag:'🇫🇷'},JP:{name:'Japan',flag:'🇯🇵'},CN:{name:'China',flag:'🇨🇳'},AU:{name:'Australia',flag:'🇦🇺'},CA:{name:'Canada',flag:'🇨🇦'},BR:{name:'Brazil',flag:'🇧🇷'},NG:{name:'Nigeria',flag:'🇳🇬'},PK:{name:'Pakistan',flag:'🇵🇰'},SA:{name:'Saudi Arabia',flag:'🇸🇦'},AE:{name:'UAE',flag:'🇦🇪'},SG:{name:'Singapore',flag:'🇸🇬'},RU:{name:'Russia',flag:'🇷🇺'},TR:{name:'Turkey',flag:'🇹🇷'},MX:{name:'Mexico',flag:'🇲🇽'},AR:{name:'Argentina',flag:'🇦🇷'},EG:{name:'Egypt',flag:'🇪🇬'},ID:{name:'Indonesia',flag:'🇮🇩'},KR:{name:'South Korea',flag:'🇰🇷'},IT:{name:'Italy',flag:'🇮🇹'},ES:{name:'Spain',flag:'🇪🇸'},ZA:{name:'South Africa',flag:'🇿🇦'},MY:{name:'Malaysia',flag:'🇲🇾'},PH:{name:'Philippines',flag:'🇵🇭'},VN:{name:'Vietnam',flag:'🇻🇳'},TH:{name:'Thailand',flag:'🇹🇭'},NL:{name:'Netherlands',flag:'🇳🇱'},SE:{name:'Sweden',flag:'🇸🇪'},NO:{name:'Norway',flag:'🇳🇴'},DK:{name:'Denmark',flag:'🇩🇰'},FI:{name:'Finland',flag:'🇫🇮'},PL:{name:'Poland',flag:'🇵🇱'},UA:{name:'Ukraine',flag:'🇺🇦'},RO:{name:'Romania',flag:'🇷🇴'},GR:{name:'Greece',flag:'🇬🇷'},PT:{name:'Portugal',flag:'🇵🇹'},BE:{name:'Belgium',flag:'🇧🇪'},CH:{name:'Switzerland',flag:'🇨🇭'},AT:{name:'Austria',flag:'🇦🇹'},HU:{name:'Hungary',flag:'🇭🇺'},CZ:{name:'Czech Republic',flag:'🇨🇿'},IE:{name:'Ireland',flag:'🇮🇪'},NZ:{name:'New Zealand',flag:'🇳🇿'},CL:{name:'Chile',flag:'🇨🇱'},CO:{name:'Colombia',flag:'🇨🇴'},PE:{name:'Peru',flag:'🇵🇪'},VE:{name:'Venezuela',flag:'🇻🇪'}
};

function countryFlag(code) {
  const c = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🌐';
  return String.fromCodePoint(...[...c].map(ch => 127397 + ch.charCodeAt(0)));
}

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) {}

function countryInfo(code) {
  const c = String(code || 'XX').toUpperCase();
  if (knownCountries[c]) return knownCountries[c];
  let name = c === 'XX' ? 'Unknown' : c;
  try { if (regionNames && c !== 'XX') name = regionNames.of(c) || c; } catch (_) {}
  return { name, flag: c === 'XX' ? '🌐' : countryFlag(c) };
}

const countries = new Proxy(knownCountries, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop];
    return target[prop] || countryInfo(prop);
  }
});

function generateShortCode() {
  const chars='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code=''; for(let i=0;i<6;i++) code += chars.charAt(Math.floor(Math.random()*chars.length));
  return code;
}
function isBot(ua){ return /bot|crawler|spider|scraper|facebook|twitter|linkedin|pinterest|slack|discord|whatsapp|telegram|instagram/i.test(ua||''); }
function isSocialPreviewBot(ua){ return /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|slackbot|pinterest|skypeuripreview/i.test(ua||''); }
function getDeviceInfo(ua='') {
  let device='Desktop',browser='Unknown',os='Unknown';
  if (/Tablet|iPad/i.test(ua)) device='Tablet'; else if (/Mobile|Android|iPhone/i.test(ua)) device='Mobile';
  if (ua.includes('Chrome')&&!ua.includes('Edg')) browser='Chrome'; else if(ua.includes('Firefox')) browser='Firefox'; else if(ua.includes('Safari')&&!ua.includes('Chrome')) browser='Safari'; else if(ua.includes('Edg')) browser='Edge'; else if(ua.includes('Opera')) browser='Opera';
  if(ua.includes('Windows')) os='Windows'; else if(ua.includes('Mac OS')) os='macOS'; else if(ua.includes('Android')) os='Android'; else if(/iPhone|iPad/.test(ua)) os='iOS'; else if(ua.includes('Linux')) os='Linux';
  return {device,browser,os};
}
function normalizeClientIp(ip) {
  let value = String(ip || '').trim();
  // Railway/Express can expose IPv4 as IPv4-mapped IPv6.
  if (value.startsWith('::ffff:')) value = value.slice(7);
  // If a comma-separated forwarded chain ever reaches here, use the first IP.
  if (value.includes(',')) value = value.split(',')[0].trim();
  // Remove brackets around IPv6 literals.
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  return value;
}
function normalizeHost(host){ return String(host||'').split(':')[0].toLowerCase().replace(/^www\./,''); }
function domainOrigin(domain){ const clean=normalizeHost(domain); return clean===normalizeHost(BASE_HOST)?BASE_URL:`https://${clean}`; }
function getBaseUrl(req){ const host=normalizeHost(req.get('host')); return AVAILABLE_DOMAINS.map(normalizeHost).includes(host)?domainOrigin(host):BASE_URL; }
function buildShortUrl(link){ return `${domainOrigin(normalizeHost(link.selectedDomain||BASE_HOST))}/${link.shortCode}`; }
function escapeHtml(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
function renderSocialPreview(req,res,link){
  const shortUrl=buildShortUrl(link), host=normalizeHost(link.selectedDomain||req.get('host')||BASE_HOST), title=host, description=PREVIEW_DESCRIPTION;
  res.set('Cache-Control','public, max-age=300');
  return res.status(200).type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(shortUrl)}"><meta property="og:type" content="website"><meta property="og:site_name" content="${escapeHtml(title)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(shortUrl)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"></head><body></body></html>`);
}

async function getUserById(id){ const r=await pool.query('SELECT * FROM users WHERE id=$1',[id]); return mapUser(r.rows[0]); }
async function getActiveOnlineUsers(){
  await pool.query("DELETE FROM online_users WHERE last_seen < NOW() - INTERVAL '5 minutes'");
  const r=await pool.query('SELECT * FROM online_users ORDER BY last_seen DESC'); return r.rows.map(mapOnline);
}
async function markOnline(user){
  if(!user) return;
  await pool.query(`INSERT INTO online_users(user_id,username,display_name,last_seen) VALUES($1,$2,$3,NOW())
    ON CONFLICT(user_id) DO UPDATE SET username=EXCLUDED.username, display_name=EXCLUDED.display_name, last_seen=NOW()`,[user.id,user.username||'',user.displayName||'']);
}

async function authMiddleware(req,res,next){
  try {
    if(req.session?.user?.id){
      const user=await getUserById(req.session.user.id);
      if(user){
        req.user=user;
        return next();
      }

      // Session may survive a deploy even when the old user row no longer exists.
      // Clear that stale user session before redirecting to login.
      delete req.session.user;
      if(req.originalUrl!=='/login') req.session.returnTo=req.originalUrl;
      return req.session.save((err)=>{
        if(err) console.error('Stale session save error:',err);
        res.redirect('/login');
      });
    }

    if(req.originalUrl!=='/login') req.session.returnTo=req.originalUrl;
    return res.redirect('/login');
  } catch(e){
    console.error('Auth error:',e);
    return res.redirect('/login?error='+encodeURIComponent('Database connection error'));
  }
}

// ===== ONLINE HEARTBEAT =====
// Never write to online_users until the referenced user is confirmed to exist.
// This prevents foreign-key errors from stale PostgreSQL sessions after migration/redeploy.
app.use(async (req,res,next)=>{
  if(!req.session?.user?.id) return next();

  try {
    const user=await getUserById(req.session.user.id);

    if(!user){
      console.warn(`⚠️ Stale session cleared for missing user id ${req.session.user.id}`);
      delete req.session.user;
      return req.session.save((err)=>{
        if(err) console.error('Stale session cleanup error:',err);
        next();
      });
    }

    await markOnline(user);
  } catch(e){
    console.error('Online heartbeat error:',e.message);
  }

  next();
});

// ===== HOME =====
app.get('/', async (req,res)=>{
  try {
    const [activeUsers,totalR,recentR] = await Promise.all([
      getActiveOnlineUsers(), pool.query('SELECT COUNT(*)::int AS count FROM users'),
      pool.query('SELECT * FROM users ORDER BY created_at DESC LIMIT 30')
    ]);
    const loggedUser=req.session?.user?.id?await getUserById(req.session.user.id):null;
    res.render('index',{page:'home',user:loggedUser,onlineUsers:activeUsers.length,onlineUserList:activeUsers.map(u=>({name:u.displayName||u.username||'User'})),totalUsers:Number(totalR.rows[0].count),registeredUserList:recentR.rows.map(mapUser).map(u=>({name:u.displayName||[u.firstName,u.lastName].filter(Boolean).join(' ')||u.username||'User',username:u.username||''})),countries,error:req.query.error||null,success:req.query.success||null,info:null,shortUrl:null,customDomains:CUSTOM_DOMAINS,availableDomains:AVAILABLE_DOMAINS,baseDomain:BASE_HOST,baseUrl:BASE_URL});
  }catch(e){ console.error('Home error:',e); res.status(500).send('Database error: '+e.message); }
});

// ===== LOGIN =====
app.get('/login',async(req,res)=>{
  try {
    if(req.session?.user?.id){ const u=await getUserById(req.session.user.id); if(u) return res.redirect('/dashboard'); }
    const [activeUsers,totalR]=await Promise.all([getActiveOnlineUsers(),pool.query('SELECT COUNT(*)::int AS count FROM users')]);
    res.render('index',{page:'login',user:null,onlineUsers:activeUsers.length,onlineUserList:activeUsers.map(u=>({name:u.displayName||u.username||'User'})),countries,error:req.query.error||null,success:req.query.success||null,info:null,shortUrl:req.query.shortUrl||null,totalUsers:Number(totalR.rows[0].count),customDomains:CUSTOM_DOMAINS,availableDomains:AVAILABLE_DOMAINS,baseDomain:BASE_HOST,baseUrl:getBaseUrl(req)});
  }catch(e){ console.error('Login page error:',e); res.status(500).send('Login page error: '+e.message); }
});

app.post('/login',async(req,res)=>{
  try {
    const {telegramId,username,firstName,lastName,email,timezone}=req.body;
    if(!telegramId||!username||!firstName) return res.redirect('/login?error='+encodeURIComponent('Please fill in all required fields'));
    const displayName=firstName+(lastName?' '+lastName:'');
    const q=await pool.query(`INSERT INTO users(telegram_id,username,first_name,last_name,display_name,email,timezone,last_login)
      VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username,first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,display_name=EXCLUDED.display_name,email=CASE WHEN EXCLUDED.email<>'' THEN EXCLUDED.email ELSE users.email END,timezone=EXCLUDED.timezone,last_login=NOW()
      RETURNING *`,[String(telegramId),String(username),String(firstName),String(lastName||''),displayName,String(email||''),String(timezone||'Asia/Dhaka')]);
    const user=mapUser(q.rows[0]); await markOnline(user);
    req.session.user={id:user.id,telegramId:user.telegramId,username:user.username,displayName:user.displayName,firstName:user.firstName,email:user.email,profilePhoto:user.profilePhoto,timezone:user.timezone,isAdmin:user.isAdmin};
    const requested=req.session.returnTo; const returnTo=requested&&requested!=='/login'&&requested.startsWith('/')?requested:'/dashboard'; delete req.session.returnTo;
    return req.session.save(err=>{ if(err){console.error('Session save error:',err);return res.redirect('/login?error='+encodeURIComponent('Could not save login session'));} res.redirect(returnTo); });
  }catch(e){ console.error('Login error:',e); res.redirect('/login?error='+encodeURIComponent('Login failed: '+e.message)); }
});

app.post('/logout',async(req,res)=>{
  try { if(req.session?.user?.id) await pool.query('DELETE FROM online_users WHERE user_id=$1',[req.session.user.id]); } catch(e){}
  req.session.destroy(()=>res.redirect('/'));
});

// ===== DASHBOARD =====
app.get('/dashboard',authMiddleware,async(req,res)=>{
  try {
    const linkR=await pool.query('SELECT * FROM links WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]);
    const links=linkR.rows.map(mapLink).map(l=>({...l,shortUrl:buildShortUrl(l)}));
    const clickR=await pool.query('SELECT * FROM clicks WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]);
    const clicks=clickR.rows.map(mapClick);
    let totalClicks=0,todayClicks=0,weekClicks=0,monthClicks=0,botClicks=0;
    const now=new Date(),today=new Date(now);today.setHours(0,0,0,0);const weekAgo=new Date(today);weekAgo.setDate(weekAgo.getDate()-7);const monthAgo=new Date(today);monthAgo.setDate(monthAgo.getDate()-30);
    const countryMap={},deviceMap={},weekData=[0,0,0,0,0,0,0];
    for(const click of clicks){
      if(click.isBot){botClicks++;continue;} totalClicks++; const d=new Date(click.createdAt); if(d>=today)todayClicks++; if(d>=weekAgo){weekClicks++;const di=d.getDay(),ai=di===0?6:di-1;weekData[ai]++;} if(d>=monthAgo)monthClicks++;
      const cc=click.countryCode||'XX';countryMap[cc]=(countryMap[cc]||0)+1; const dk=(click.device||'Unknown')+'|'+(click.browser||'Unknown')+'|'+(click.os||'Unknown'); if(!deviceMap[dk])deviceMap[dk]={device:click.device,browser:click.browser,os:click.os,count:0};deviceMap[dk].count++;
    }
    const realClicks=totalClicks,clickRate=(totalClicks+botClicks)>0?Math.round(totalClicks/(totalClicks+botClicks)*100):0;
    const countryStats=Object.entries(countryMap).map(([countryCode,count])=>({countryCode,count})).sort((a,b)=>b.count-a.count).slice(0,15);
    const deviceStats=Object.values(deviceMap).sort((a,b)=>b.count-a.count).slice(0,20);
    const activeUsers=await getActiveOnlineUsers();
    res.render('index',{page:'dashboard',user:req.user,links,totalClicks,todayClicks,weekClicks,monthClicks,botClicks,realClicks,clickRate,onlineUsers:activeUsers.length,countryStats,deviceStats,weekData,countries,onlineUserList:activeUsers.map(u=>({name:u.displayName||u.username||'User'})),error:req.query.error||null,success:req.query.success||null,info:null,shortUrl:null,customDomains:CUSTOM_DOMAINS,availableDomains:AVAILABLE_DOMAINS,baseDomain:BASE_HOST,baseUrl:getBaseUrl(req)});
  }catch(e){ console.error('Dashboard error:',e); res.redirect('/?error='+encodeURIComponent('Dashboard database error')); }
});

// ===== SHORT LINK PAGE =====
app.get('/shorten-page',authMiddleware,async(req,res)=>{
  try {
    const r=await pool.query('SELECT * FROM links WHERE user_id=$1 ORDER BY created_at DESC LIMIT 12',[req.user.id]);
    const links=r.rows.map(mapLink).map(l=>({...l,shortUrl:buildShortUrl(l)})); const active=await getActiveOnlineUsers();
    res.render('index',{page:'shorten',user:req.user,links,onlineUsers:active.length,onlineUserList:active.map(u=>({name:u.displayName||u.username||'User'})),countries,error:req.query.error||null,success:req.query.success||null,info:null,shortUrl:req.query.shortUrl||null,customDomains:CUSTOM_DOMAINS,availableDomains:AVAILABLE_DOMAINS,baseDomain:BASE_HOST,baseUrl:BASE_URL});
  }catch(e){console.error('Shorten page error:',e);res.redirect('/dashboard?error='+encodeURIComponent('Could not open short link page'));}
});

app.post('/shorten',authMiddleware,async(req,res)=>{
  try {
    const {originalUrl,customSlug,expiresIn,domain}=req.body; const requestedDomain=normalizeHost(domain||BASE_HOST); const selectedDomain=AVAILABLE_DOMAINS.map(normalizeHost).includes(requestedDomain)?requestedDomain:normalizeHost(BASE_HOST);
    if(!originalUrl)return res.redirect('/shorten-page?error='+encodeURIComponent('Please enter a URL')); try{new URL(originalUrl);}catch(e){return res.redirect('/shorten-page?error='+encodeURIComponent('Invalid URL format'));}
    let shortCode=String(customSlug||'').trim();
    if(shortCode){ if(!/^[A-Za-z0-9_-]{2,80}$/.test(shortCode))return res.redirect('/shorten-page?error='+encodeURIComponent('Custom slug may use letters, numbers, - and _ only')); const ex=await pool.query('SELECT 1 FROM links WHERE selected_domain=$1 AND short_code=$2',[selectedDomain,shortCode]); if(ex.rowCount)return res.redirect('/shorten-page?error='+encodeURIComponent('Custom slug already taken on this domain')); }
    else { for(let i=0;i<12;i++){const c=generateShortCode();const ex=await pool.query('SELECT 1 FROM links WHERE selected_domain=$1 AND short_code=$2',[selectedDomain,c]);if(!ex.rowCount){shortCode=c;break;}} if(!shortCode)throw new Error('Could not generate unique short code'); }
    let expiresAt=null;if(expiresIn){const days=parseInt(expiresIn);if(!isNaN(days))expiresAt=new Date(Date.now()+days*86400000);}
    const q=await pool.query(`INSERT INTO links(user_id,selected_domain,original_url,short_code,custom_slug,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.user.id,selectedDomain,originalUrl,shortCode,customSlug||null,expiresAt]);
    await pool.query('UPDATE users SET total_links=total_links+1 WHERE id=$1',[req.user.id]); const link=mapLink(q.rows[0]); const shortUrl=buildShortUrl(link);
    res.redirect('/shorten-page?success='+encodeURIComponent('Link created successfully!')+'&shortUrl='+encodeURIComponent(shortUrl));
  }catch(e){console.error('Shorten error:',e);res.redirect('/shorten-page?error='+encodeURIComponent('Failed to create short link: '+e.message));}
});

// ===== QR =====
app.get('/qr/:code',async(req,res)=>{
  try { const q=await pool.query('SELECT * FROM links WHERE short_code=$1 ORDER BY id DESC LIMIT 1',[req.params.code]);if(!q.rowCount)return res.status(404).json({error:'Link not found'});const link=mapLink(q.rows[0]),url=buildShortUrl(link);const qr=await QRCode.toDataURL(url,{errorCorrectionLevel:'H',margin:2,scale:8,color:{dark:'#000000',light:'#FFFFFF'}});res.json({qr,url}); }catch(e){console.error('QR error:',e);res.status(500).json({error:'Failed to generate QR code'});}
});

// ===== LINK MANAGEMENT =====
app.post('/update-link/:id',authMiddleware,async(req,res)=>{
  try{const {newUrl}=req.body;if(!newUrl)return res.redirect('/dashboard?error='+encodeURIComponent('Please enter a URL'));try{new URL(newUrl);}catch(e){return res.redirect('/dashboard?error='+encodeURIComponent('Invalid URL format'));}const q=await pool.query('UPDATE links SET original_url=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3 RETURNING id',[newUrl,Number(req.params.id),req.user.id]);if(!q.rowCount)return res.redirect('/dashboard?error='+encodeURIComponent('Link not found'));res.redirect('/dashboard?success='+encodeURIComponent('Link updated successfully!'));}catch(e){res.redirect('/dashboard?error='+encodeURIComponent('Failed to update link'));}
});
app.post('/toggle-link/:id',authMiddleware,async(req,res)=>{
  try{const q=await pool.query('UPDATE links SET is_active=NOT is_active,updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING id',[Number(req.params.id),req.user.id]);if(!q.rowCount)return res.redirect('/dashboard?error='+encodeURIComponent('Link not found'));res.redirect('/dashboard?success='+encodeURIComponent('Link toggled successfully!'));}catch(e){res.redirect('/dashboard?error='+encodeURIComponent('Failed to toggle link'));}
});
app.post('/delete-link/:id',authMiddleware,async(req,res)=>{
  try{const q=await pool.query('DELETE FROM links WHERE id=$1 AND user_id=$2 RETURNING id',[Number(req.params.id),req.user.id]);if(!q.rowCount)return res.redirect('/dashboard?error='+encodeURIComponent('Link not found'));await pool.query('UPDATE users SET total_links=GREATEST(total_links-1,0) WHERE id=$1',[req.user.id]);res.redirect('/dashboard?success='+encodeURIComponent('Link deleted successfully!'));}catch(e){res.redirect('/dashboard?error='+encodeURIComponent('Failed to delete link'));}
});

// ===== USER APIs =====
app.get('/api/user-data',authMiddleware,async(req,res)=>{
  try{const user=await getUserById(req.user.id);const [lr,cr]=await Promise.all([pool.query('SELECT COUNT(*)::int AS count FROM links WHERE user_id=$1',[user.id]),pool.query('SELECT COUNT(*)::int AS count FROM clicks WHERE user_id=$1 AND is_bot=FALSE',[user.id])]);const fields=['displayName','email','username','firstName','lastName'];const filled=fields.filter(f=>user[f]).length;res.json({...user,totalLinks:Number(lr.rows[0].count),totalClicks:Number(cr.rows[0].count),completion:Math.round(filled/fields.length*100)});}catch(e){res.status(500).json({error:'Failed to load user data'});}
});
app.post('/api/update-profile',authMiddleware,async(req,res)=>{
  try{const current=await getUserById(req.user.id);const first=req.body.firstName!==undefined?String(req.body.firstName):current.firstName,last=req.body.lastName!==undefined?String(req.body.lastName):current.lastName,display=req.body.displayName!==undefined?String(req.body.displayName):(first+(last?' '+last:'')),email=req.body.email!==undefined?String(req.body.email):current.email,photo=req.body.profilePhoto!==undefined?String(req.body.profilePhoto):current.profilePhoto,tz=req.body.timezone!==undefined?String(req.body.timezone):current.timezone;const q=await pool.query('UPDATE users SET first_name=$1,last_name=$2,display_name=$3,email=$4,profile_photo=$5,timezone=$6 WHERE id=$7 RETURNING *',[first,last,display,email,photo,tz,current.id]);const user=mapUser(q.rows[0]);await markOnline(user);Object.assign(req.session.user,{displayName:user.displayName,firstName:user.firstName,email:user.email,profilePhoto:user.profilePhoto,timezone:user.timezone});res.json({success:true,user});}catch(e){res.status(500).json({error:'Failed to update profile'});}
});
app.post('/api/update-timezone',authMiddleware,async(req,res)=>{
  try{if(!req.body.timezone)return res.status(400).json({error:'Timezone is required'});await pool.query('UPDATE users SET timezone=$1 WHERE id=$2',[String(req.body.timezone),req.user.id]);req.session.user.timezone=String(req.body.timezone);res.json({success:true,timezone:req.body.timezone});}catch(e){res.status(500).json({error:'Failed to update timezone'});}
});
app.get('/api/online-users',async(req,res)=>{try{const a=await getActiveOnlineUsers();res.json({count:a.length,users:a.map(u=>({name:u.displayName||u.username||'User'}))});}catch(e){res.json({count:0,users:[]});}});

// ===== HEALTH =====
app.get('/health',async(req,res)=>{
  try{const db=await pool.query('SELECT NOW() AS now');res.json({status:'ok',database:'postgresql',dbTime:db.rows[0].now,domains:AVAILABLE_DOMAINS,baseUrl:BASE_URL,uptime:process.uptime()});}catch(e){res.status(500).json({status:'error',database:'down',error:e.message});}
});

// ===== SHORT URL REDIRECT (keep after all named routes) =====
app.get('/:code',async(req,res)=>{
  try{
    const code=req.params.code;if(['favicon.ico','robots.txt','sitemap.xml'].includes(code))return res.status(404).send('Not found');
    const requestHost=normalizeHost(req.get('host'));const q=await pool.query('SELECT * FROM links WHERE selected_domain=$1 AND short_code=$2 AND is_active=TRUE LIMIT 1',[requestHost,code]);if(!q.rowCount)return res.status(404).send('Link not found or inactive');let link=mapLink(q.rows[0]);
    if(link.isExpired||(link.expiresAt&&new Date(link.expiresAt)<new Date())){await pool.query('UPDATE links SET is_expired=TRUE WHERE id=$1',[link.id]);return res.status(410).send('This link has expired');}
    const ip=normalizeClientIp(req.ip||req.connection.remoteAddress||''),ua=req.headers['user-agent']||'',ref=req.headers['referer']||req.headers['referrer']||'',bot=isBot(ua),di=getDeviceInfo(ua);let countryCode='XX';try{const geo=require('geoip-lite').lookup(ip);if(geo?.country)countryCode=String(geo.country).toUpperCase();}catch(e){}
    await pool.query(`INSERT INTO clicks(link_id,user_id,ip_address,user_agent,device,browser,os,country,country_code,referrer,is_bot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[link.id,link.userId,ip,ua,di.device,di.browser,di.os,countryInfo(countryCode).name,countryCode,ref,bot]);
    if(!bot){await Promise.all([pool.query('UPDATE links SET clicks=clicks+1 WHERE id=$1',[link.id]),pool.query('UPDATE users SET total_clicks=total_clicks+1 WHERE id=$1',[link.userId])]);}
    if(isSocialPreviewBot(ua))return renderSocialPreview(req,res,link);res.set('Cache-Control','no-store');return res.redirect(302,link.originalUrl);
  }catch(e){console.error('Redirect error:',e);res.status(500).send('Error redirecting');}
});

// ===== 404 =====
app.use(async(req,res)=>{
  let user=null,active=[];try{if(req.session?.user?.id)user=await getUserById(req.session.user.id);active=await getActiveOnlineUsers();}catch(e){}
  res.status(404).render('index',{page:'404',user,onlineUsers:active.length,onlineUserList:active.map(u=>({name:u.displayName||u.username||'User'})),countries,error:'Page not found',success:null,info:null,shortUrl:null,customDomains:CUSTOM_DOMAINS,availableDomains:AVAILABLE_DOMAINS,baseDomain:BASE_HOST,baseUrl:getBaseUrl(req)});
});

async function start(){
  try{
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connected');
    await initDatabase();
    await migrateLegacyJsonIfPossible();
    console.log('✅ Session store: PostgreSQL');
    app.listen(PORT,'0.0.0.0',()=>{
      console.log(`🚀 Server running on port ${PORT}`);console.log(`📡 Base URL: ${BASE_URL}`);console.log('🌐 Available Domains:');AVAILABLE_DOMAINS.forEach((d,i)=>console.log(`   ${i+1}. https://${d}`));console.log(`✅ Health check: ${BASE_URL}/health`);console.log(`🔐 Login page: ${BASE_URL}/login`);console.log(`📊 Dashboard: ${BASE_URL}/dashboard`);
    });
  }catch(e){console.error('❌ Database startup failed:',e);process.exit(1);}
}
start();
