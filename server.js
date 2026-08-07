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
const SESSION_SECRET = process.env.SESSION_SECRET || 'your-secret-key-change-this';

// Railway/Reverse proxy support (required for secure cookies, req.ip and express-rate-limit)
app.set('trust proxy', 1);

// ===== DOMAIN CONFIG =====
const BASE_URL = (process.env.BASE_URL || 'https://thispersonisbrandshortner.com').replace(/\/$/, '');
const BASE_HOST = new URL(BASE_URL).hostname.toLowerCase();
const CUSTOM_DOMAINS = [
  process.env.DOMAIN_1, process.env.DOMAIN_2, process.env.DOMAIN_3,
  process.env.DOMAIN_4, process.env.DOMAIN_5, process.env.DOMAIN_6
].filter(Boolean)
 .map(d => String(d).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase())
 .filter((d, i, arr) => d && d !== BASE_HOST && arr.indexOf(d) === i);
const AVAILABLE_DOMAINS = [BASE_HOST, ...CUSTOM_DOMAINS];
const PREVIEW_DESCRIPTION = process.env.PREVIEW_DESCRIPTION || 'Fast, clean and secure short links powered by THIS PERSON IS BRAND.';

// ===== VIEW ENGINE SETUP =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===== STATIC FILES =====
app.use(express.static(path.join(__dirname, 'public')));

// ===== DATA STORAGE =====
const DATA_FILE = './data.json';

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    users: [],
    links: [],
    clicks: [],
    onlineUsers: [],
    counters: { linkId: 1, clickId: 1, userId: 1 }
  }, null, 2));
}

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    console.error('Error reading data:', error);
    return { users: [], links: [], clicks: [], onlineUsers: [], counters: { linkId: 1, clickId: 1, userId: 1 } };
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing data:', error);
  }
}

// ===== MIDDLEWARE =====
app.use(helmet({ 
  contentSecurityPolicy: false, 
  crossOriginEmbedderPolicy: false 
}));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// ===== SESSION STORE =====
// Railway production: persist login sessions in PostgreSQL when DATABASE_URL is set.
// If DATABASE_URL is missing, fall back to MemoryStore so the site can still boot.
let sessionStore;
let sessionPool = null;

if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
  try {
    const dbUrl = process.env.DATABASE_URL.trim();
    const isRailwayInternal = /\.railway\.internal(?::\d+)?\//i.test(dbUrl);

    sessionPool = new Pool({
      connectionString: dbUrl,
      ssl: isRailwayInternal ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    sessionPool.on('error', (err) => {
      console.error('PostgreSQL session pool error:', err.message);
    });

    sessionStore = new pgSession({
      pool: sessionPool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15,
      errorLog: (err) => console.error('PostgreSQL session store error:', err)
    });

    console.log('✅ Session store: PostgreSQL');
  } catch (error) {
    console.error('⚠️ Failed to configure PostgreSQL session store:', error.message);
    console.warn('⚠️ Falling back to MemoryStore. Check DATABASE_URL.');
  }
} else {
  console.warn('⚠️ DATABASE_URL is not set. Using temporary MemoryStore for sessions.');
}

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

// ===== COUNTRY DATA =====
const countries = {
  'BD': { name: 'Bangladesh', flag: '🇧🇩' },
  'IN': { name: 'India', flag: '🇮🇳' },
  'US': { name: 'United States', flag: '🇺🇸' },
  'GB': { name: 'United Kingdom', flag: '🇬🇧' },
  'DE': { name: 'Germany', flag: '🇩🇪' },
  'FR': { name: 'France', flag: '🇫🇷' },
  'JP': { name: 'Japan', flag: '🇯🇵' },
  'CN': { name: 'China', flag: '🇨🇳' },
  'AU': { name: 'Australia', flag: '🇦🇺' },
  'CA': { name: 'Canada', flag: '🇨🇦' },
  'BR': { name: 'Brazil', flag: '🇧🇷' },
  'NG': { name: 'Nigeria', flag: '🇳🇬' },
  'PK': { name: 'Pakistan', flag: '🇵🇰' },
  'SA': { name: 'Saudi Arabia', flag: '🇸🇦' },
  'AE': { name: 'UAE', flag: '🇦🇪' },
  'SG': { name: 'Singapore', flag: '🇸🇬' },
  'RU': { name: 'Russia', flag: '🇷🇺' },
  'TR': { name: 'Turkey', flag: '🇹🇷' },
  'MX': { name: 'Mexico', flag: '🇲🇽' },
  'AR': { name: 'Argentina', flag: '🇦🇷' },
  'EG': { name: 'Egypt', flag: '🇪🇬' },
  'ID': { name: 'Indonesia', flag: '🇮🇩' },
  'KR': { name: 'South Korea', flag: '🇰🇷' },
  'IT': { name: 'Italy', flag: '🇮🇹' },
  'ES': { name: 'Spain', flag: '🇪🇸' },
  'ZA': { name: 'South Africa', flag: '🇿🇦' },
  'MY': { name: 'Malaysia', flag: '🇲🇾' },
  'PH': { name: 'Philippines', flag: '🇵🇭' },
  'VN': { name: 'Vietnam', flag: '🇻🇳' },
  'TH': { name: 'Thailand', flag: '🇹🇭' },
  'NL': { name: 'Netherlands', flag: '🇳🇱' },
  'SE': { name: 'Sweden', flag: '🇸🇪' },
  'NO': { name: 'Norway', flag: '🇳🇴' },
  'DK': { name: 'Denmark', flag: '🇩🇰' },
  'FI': { name: 'Finland', flag: '🇫🇮' },
  'PL': { name: 'Poland', flag: '🇵🇱' },
  'UA': { name: 'Ukraine', flag: '🇺🇦' },
  'RO': { name: 'Romania', flag: '🇷🇴' },
  'GR': { name: 'Greece', flag: '🇬🇷' },
  'PT': { name: 'Portugal', flag: '🇵🇹' },
  'BE': { name: 'Belgium', flag: '🇧🇪' },
  'CH': { name: 'Switzerland', flag: '🇨🇭' },
  'AT': { name: 'Austria', flag: '🇦🇹' },
  'HU': { name: 'Hungary', flag: '🇭🇺' },
  'CZ': { name: 'Czech Republic', flag: '🇨🇿' },
  'IE': { name: 'Ireland', flag: '🇮🇪' },
  'NZ': { name: 'New Zealand', flag: '🇳🇿' },
  'CL': { name: 'Chile', flag: '🇨🇱' },
  'CO': { name: 'Colombia', flag: '🇨🇴' },
  'PE': { name: 'Peru', flag: '🇵🇪' },
  'VE': { name: 'Venezuela', flag: '🇻🇪' }
};

// ===== HELPER FUNCTIONS =====
function generateShortCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function isBot(userAgent) {
  const botPatterns = /bot|crawler|spider|scraper|facebook|twitter|linkedin|pinterest|slack|discord|whatsapp|telegram|instagram/i;
  return botPatterns.test(userAgent);
}

function getDeviceInfo(userAgent) {
  const ua = userAgent || '';
  let device = 'Unknown';
  let browser = 'Unknown';
  let os = 'Unknown';

  if (ua.includes('Mobile') || ua.includes('Android') || ua.includes('iPhone') || ua.includes('iPad')) {
    device = 'Mobile';
  } else if (ua.includes('Tablet') || ua.includes('iPad')) {
    device = 'Tablet';
  } else {
    device = 'Desktop';
  }

  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edge')) browser = 'Edge';
  else if (ua.includes('Opera')) browser = 'Opera';
  else if (ua.includes('MSIE') || ua.includes('Trident')) browser = 'Internet Explorer';

  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  return { device, browser, os };
}

function normalizeHost(host) {
  return String(host || '').split(':')[0].toLowerCase().replace(/^www\./, '');
}

function domainOrigin(domain) {
  const clean = normalizeHost(domain);
  return clean === normalizeHost(BASE_HOST) ? BASE_URL : `https://${clean}`;
}

function getBaseUrl(req) {
  const host = normalizeHost(req.get('host'));
  if (AVAILABLE_DOMAINS.map(normalizeHost).includes(host)) return domainOrigin(host);
  return BASE_URL;
}

function buildShortUrl(link) {
  const domain = normalizeHost(link.selectedDomain || BASE_HOST);
  return `${domainOrigin(domain)}/${link.shortCode}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function isSocialPreviewBot(userAgent) {
  return /facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|slackbot|pinterest|skypeuripreview/i.test(userAgent || '');
}

function renderSocialPreview(req, res, link) {
  const shortUrl = buildShortUrl(link);
  const host = normalizeHost(link.selectedDomain || req.get('host') || BASE_HOST);
  const title = host;
  const description = PREVIEW_DESCRIPTION;
  res.set('Cache-Control', 'public, max-age=300');
  return res.status(200).type('html').send(`<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(shortUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(title)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(shortUrl)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
</head><body></body></html>`);
}

// ===== AUTH MIDDLEWARE =====
function authMiddleware(req, res, next) {
  if (req.session && req.session.user) {
    const data = readData();
    const user = data.users.find(u => u.id === req.session.user.id);
    if (user) {
      req.user = user;
      return next();
    }
  }
  if (req.originalUrl !== '/login') req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

// ===== ONLINE STATUS HEARTBEAT =====
// Must be registered BEFORE routes so dashboard/API requests refresh lastSeen.
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    const data = readData();
    const onlineUser = data.onlineUsers.find(u => u.id === req.session.user.id);
    if (onlineUser) {
      onlineUser.lastSeen = Date.now();
      onlineUser.username = req.session.user.username;
      onlineUser.displayName = req.session.user.displayName;
    } else {
      data.onlineUsers.push({
        id: req.session.user.id,
        username: req.session.user.username,
        displayName: req.session.user.displayName,
        lastSeen: Date.now()
      });
    }
    writeData(data);
  }
  next();
});

// ===== ROUTES =====

// ===== HOME PAGE =====
app.get('/', (req, res) => {
  try {
    const data = readData();
    const now = Date.now();
    const activeUsers = (data.onlineUsers || []).filter(u => (now - u.lastSeen) < 5 * 60 * 1000);
    if (activeUsers.length !== (data.onlineUsers || []).length) {
      data.onlineUsers = activeUsers;
      writeData(data);
    }
    const loggedUser = req.session?.user ? data.users.find(u => u.id === req.session.user.id) || null : null;
    const onlineUserList = activeUsers.map(u => ({ name: u.displayName || u.username || 'User' }));
    const registeredUserList = data.users.slice(-30).reverse().map(u => ({
      name: u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'User',
      username: u.username || ''
    }));
    res.render('index', {
      page: 'home', user: loggedUser,
      onlineUsers: activeUsers.length, onlineUserList,
      totalUsers: data.users.length, registeredUserList,
      countries, error: req.query.error || null, success: req.query.success || null, info: null,
      shortUrl: null, customDomains: CUSTOM_DOMAINS, availableDomains: AVAILABLE_DOMAINS,
      baseDomain: BASE_HOST, baseUrl: BASE_URL
    });
  } catch (error) {
    console.error('Home error:', error);
    res.redirect('/login');
  }
});

// ===== LOGIN PAGE =====
app.get('/login', (req, res) => {
  try {
    // Read data once for this request so it is available for both
    // session lookup and template statistics.
    const data = readData();

    // If already logged in, redirect to dashboard
    if (req.session && req.session.user) {
      const user = data.users.find(u => u.id === req.session.user.id);
      if (user) {
        return res.redirect('/dashboard');
      }
    }

    const now = Date.now();
    const activeUsers = (data.onlineUsers || []).filter(u => (now - Number(u.lastSeen || 0)) < 5 * 60 * 1000);
    if (activeUsers.length !== (data.onlineUsers || []).length) {
      data.onlineUsers = activeUsers;
      writeData(data);
    }

    res.render('index', {
      page: 'login',
      user: null,
      onlineUsers: activeUsers.length,
      onlineUserList: activeUsers.map(u => ({ name: u.displayName || u.username || 'User' })),
      countries: countries,
      error: req.query.error || null,
      success: req.query.success || null,
      info: null,
      shortUrl: req.query.shortUrl || null,
      totalUsers: data.users.length,
      customDomains: CUSTOM_DOMAINS,
      availableDomains: AVAILABLE_DOMAINS,
      baseDomain: BASE_HOST,
      baseUrl: getBaseUrl(req)
    });
  } catch (error) {
    console.error('Login page error:', error);
    res.send('Login page error: ' + error.message);
  }
});

// ===== LOGIN POST =====
app.post('/login', (req, res) => {
  try {
    const { telegramId, username, firstName, lastName, email, timezone } = req.body;
    
    if (!telegramId || !username || !firstName) {
      return res.render('index', {
        page: 'login',
        user: null,
        onlineUsers: 0,
        onlineUserList: [],
        countries: countries,
        error: 'Please fill in all required fields',
        success: null,
        info: null,
        shortUrl: null,
        customDomains: CUSTOM_DOMAINS,
        availableDomains: AVAILABLE_DOMAINS,
        baseDomain: BASE_HOST,
        baseUrl: getBaseUrl(req)
      });
    }

    const data = readData();
    let user = data.users.find(u => u.telegramId === telegramId);
    
    if (!user) {
      const newId = data.counters.userId + 1;
      user = {
        id: newId,
        telegramId: telegramId,
        username: username,
        firstName: firstName,
        lastName: lastName || '',
        displayName: firstName + (lastName ? ' ' + lastName : ''),
        email: email || '',
        profilePhoto: '',
        timezone: timezone || 'Asia/Dhaka',
        accountStatus: 'active',
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        totalLinks: 0,
        totalClicks: 0,
        isAdmin: false
      };
      data.users.push(user);
      data.counters.userId = newId;
      writeData(data);
    } else {
      user.username = username;
      user.firstName = firstName;
      user.lastName = lastName || '';
      user.displayName = firstName + (lastName ? ' ' + lastName : '');
      if (email) user.email = email;
      if (timezone) user.timezone = timezone;
      user.lastLogin = new Date().toISOString();
      
      const onlineUser = data.onlineUsers.find(u => u.id === user.id);
      if (onlineUser) {
        onlineUser.lastSeen = Date.now();
      } else {
        data.onlineUsers.push({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          lastSeen: Date.now()
        });
      }
      writeData(data);
    }

    // Mark this user online immediately after every successful login
    const freshOnlineData = readData();
    const onlineIndex = freshOnlineData.onlineUsers.findIndex(u => u.id === user.id);
    const onlineRecord = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      lastSeen: Date.now()
    };
    if (onlineIndex >= 0) freshOnlineData.onlineUsers[onlineIndex] = onlineRecord;
    else freshOnlineData.onlineUsers.push(onlineRecord);
    writeData(freshOnlineData);

    req.session.user = {
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
      displayName: user.displayName,
      firstName: user.firstName,
      email: user.email,
      profilePhoto: user.profilePhoto,
      timezone: user.timezone,
      isAdmin: user.isAdmin
    };

    const requestedReturnTo = req.session.returnTo;
    const returnTo = (requestedReturnTo && requestedReturnTo !== '/login' && requestedReturnTo.startsWith('/')) ? requestedReturnTo : '/dashboard';
    delete req.session.returnTo;
    return req.session.save((sessionError) => {
      if (sessionError) {
        console.error('Session save error:', sessionError);
        return res.redirect('/login?error=' + encodeURIComponent('Could not save login session. Please try again.'));
      }
      res.redirect(returnTo);
    });
  } catch (error) {
    console.error('Login error:', error);
    res.render('index', {
      page: 'login',
      user: null,
      onlineUsers: 0,
      onlineUserList: [],
      countries: countries,
      error: 'Login failed: ' + error.message,
      success: null,
      info: null,
      shortUrl: null,
      customDomains: CUSTOM_DOMAINS,
      availableDomains: AVAILABLE_DOMAINS,
      baseDomain: BASE_HOST,
      baseUrl: getBaseUrl(req)
    });
  }
});

// ===== LOGOUT =====
app.post('/logout', (req, res) => {
  if (req.session && req.session.user) {
    const data = readData();
    data.onlineUsers = data.onlineUsers.filter(u => u.id !== req.session.user.id);
    writeData(data);
  }
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ===== DASHBOARD (Protected) =====
app.get('/dashboard', authMiddleware, (req, res) => {
  try {
    const user = req.user;
    const data = readData();
    const links = data.links.filter(l => l.userId === user.id).sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    ).map(l => ({ ...l, shortUrl: buildShortUrl(l) }));
    
    let totalClicks = 0;
    let todayClicks = 0;
    let weekClicks = 0;
    let monthClicks = 0;
    let botClicks = 0;
    let realClicks = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const userLinkIds = links.map(l => l.id);
    const clicks = data.clicks.filter(c => userLinkIds.includes(c.linkId));

    const countryMap = {};
    const deviceMap = {};
    const weekData = [0, 0, 0, 0, 0, 0, 0];

    for (const click of clicks) {
      if (!click.isBot) {
        totalClicks++;
        
        const clickDate = new Date(click.createdAt);
        if (clickDate >= today) todayClicks++;
        
        if (clickDate >= weekAgo) {
          weekClicks++;
          const dayIndex = clickDate.getDay();
          const adjustedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
          weekData[adjustedIndex]++;
        }
        
        if (clickDate >= monthAgo) monthClicks++;
        
        const countryCode = click.countryCode || 'XX';
        if (!countryMap[countryCode]) countryMap[countryCode] = 0;
        countryMap[countryCode]++;
        
        const deviceKey = click.device + '|' + click.browser + '|' + click.os;
        if (!deviceMap[deviceKey]) deviceMap[deviceKey] = { device: click.device, browser: click.browser, os: click.os, count: 0 };
        deviceMap[deviceKey].count++;
      } else {
        botClicks++;
      }
    }

    realClicks = totalClicks;
    const clickRate = (totalClicks + botClicks) > 0 ? Math.round((totalClicks / (totalClicks + botClicks)) * 100) : 0;

    const countryStats = Object.entries(countryMap)
      .map(([code, count]) => ({ countryCode: code, count: count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const deviceStats = Object.values(deviceMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const nowOnline = Date.now();
    const onlineUsers = (data.onlineUsers || []).filter(u => (nowOnline - u.lastSeen) < 5 * 60 * 1000);
    const onlineUserList = onlineUsers.map(u => ({ name: u.displayName || u.username || 'User' }));
    if (onlineUsers.length !== (data.onlineUsers || []).length) {
      data.onlineUsers = onlineUsers;
      writeData(data);
    }

    res.render('index', {
      page: 'dashboard',
      user: user,
      links: links,
      totalClicks: totalClicks,
      todayClicks: todayClicks,
      weekClicks: weekClicks,
      monthClicks: monthClicks,
      botClicks: botClicks,
      realClicks: realClicks,
      clickRate: clickRate,
      onlineUsers: onlineUsers.length,
      countryStats: countryStats,
      deviceStats: deviceStats,
      weekData: weekData,
      countries: countries,
      onlineUserList: onlineUserList,
      error: req.query.error || null,
      success: req.query.success || null,
      info: null,
      shortUrl: null,
      customDomains: CUSTOM_DOMAINS,
      availableDomains: AVAILABLE_DOMAINS,
      baseDomain: BASE_HOST,
      baseUrl: getBaseUrl(req)
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('index', {
      page: 'dashboard',
      user: req.user,
      links: [],
      totalClicks: 0,
      todayClicks: 0,
      weekClicks: 0,
      monthClicks: 0,
      botClicks: 0,
      realClicks: 0,
      clickRate: 0,
      onlineUsers: 0,
      countryStats: [],
      deviceStats: [],
      weekData: [0, 0, 0, 0, 0, 0, 0],
      countries: countries,
      onlineUserList: [],
      error: 'Error loading dashboard',
      success: null,
      info: null,
      shortUrl: null,
      customDomains: CUSTOM_DOMAINS,
      availableDomains: AVAILABLE_DOMAINS,
      baseDomain: BASE_HOST,
      baseUrl: getBaseUrl(req)
    });
  }
});

// ===== SHORT LINK PAGE =====
app.get('/shorten-page', authMiddleware, (req, res) => {
  try {
    const data = readData();
    const userLinks = data.links.filter(l => l.userId === req.user.id)
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 12).map(l => ({ ...l, shortUrl: buildShortUrl(l) }));
    const now = Date.now();
    const activeUsers = (data.onlineUsers || []).filter(u => (now - u.lastSeen) < 5 * 60 * 1000);
    res.render('index', {
      page: 'shorten', user: req.user, links: userLinks,
      onlineUsers: activeUsers.length, onlineUserList: activeUsers.map(u => ({name: u.displayName || u.username || 'User'})),
      countries, error: req.query.error || null, success: req.query.success || null, info: null,
      shortUrl: req.query.shortUrl || null, customDomains: CUSTOM_DOMAINS, availableDomains: AVAILABLE_DOMAINS,
      baseDomain: BASE_HOST, baseUrl: BASE_URL
    });
  } catch (error) {
    console.error('Shorten page error:', error);
    res.redirect('/dashboard?error=' + encodeURIComponent('Could not open short link page'));
  }
});

// ===== SHORTEN URL =====
app.post('/shorten', authMiddleware, (req, res) => {
  try {
    const { originalUrl, customSlug, expiresIn, domain } = req.body;
    const requestedDomain = normalizeHost(domain || BASE_HOST);
    const allowedDomains = AVAILABLE_DOMAINS.map(normalizeHost);
    const selectedDomain = allowedDomains.includes(requestedDomain) ? requestedDomain : normalizeHost(BASE_HOST);
    const baseUrl = domainOrigin(selectedDomain);
    
    if (!originalUrl) {
      return res.redirect('/shorten-page?error=' + encodeURIComponent('Please enter a URL'));
    }

    try {
      new URL(originalUrl);
    } catch (e) {
      return res.redirect('/shorten-page?error=' + encodeURIComponent('Invalid URL format'));
    }

    const data = readData();
    let shortCode = generateShortCode();
    
    if (customSlug) {
      const existing = data.links.find(l => l.shortCode === customSlug);
      if (existing) {
        return res.redirect('/shorten-page?error=' + encodeURIComponent('Custom slug already taken'));
      }
      shortCode = customSlug;
    }

    let expiresAt = null;
    if (expiresIn) {
      const duration = parseInt(expiresIn);
      if (!isNaN(duration)) {
        expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    const newId = data.counters.linkId + 1;
    const link = {
      id: newId,
      userId: req.user.id,
      originalUrl: originalUrl,
      shortCode: shortCode,
      customSlug: customSlug || null,
      title: '',
      clicks: 0,
      isActive: true,
      isExpired: false,
      expiresAt: expiresAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      selectedDomain: selectedDomain
    };

    data.links.push(link);
    data.counters.linkId = newId;
    
    const user = data.users.find(u => u.id === req.user.id);
    if (user) user.totalLinks = (user.totalLinks || 0) + 1;
    
    writeData(data);

    const shortUrl = baseUrl + '/' + shortCode;

    res.redirect('/shorten-page?success=' + encodeURIComponent('Link created successfully!') + '&shortUrl=' + encodeURIComponent(shortUrl));
  } catch (error) {
    console.error('Shorten error:', error);
    res.redirect('/shorten-page?error=' + encodeURIComponent('Failed to create short link: ' + error.message));
  }
});

// ===== REDIRECT SHORT URL =====
app.get('/:code', (req, res) => {
  try {
    const code = req.params.code;
    
    // Skip if it's a known route
    if (code === 'favicon.ico' || code === 'robots.txt' || code === 'sitemap.xml') {
      return res.status(404).send('Not found');
    }
    
    const data = readData();
    const requestHost = normalizeHost(req.get('host'));
    const link = data.links.find(l => {
      const linkHost = normalizeHost(l.selectedDomain || BASE_HOST);
      return (l.shortCode === code || l.customSlug === code) && l.isActive === true && linkHost === requestHost;
    });

    if (!link) {
      return res.status(404).send('Link not found or inactive');
    }

    if (link.isExpired || (link.expiresAt && new Date(link.expiresAt) < new Date())) {
      link.isExpired = true;
      writeData(data);
      return res.status(410).send('This link has expired');
    }

    const ip = req.ip || req.connection.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || '';

    const isBotUser = isBot(userAgent);
    const deviceInfo = getDeviceInfo(userAgent);

    let countryCode = 'XX';
    try {
      const geo = require('geoip-lite');
      const geoData = geo.lookup(ip);
      if (geoData && geoData.country) {
        countryCode = geoData.country;
      }
    } catch (e) {}

    const newId = data.counters.clickId + 1;
    const click = {
      id: newId,
      linkId: link.id,
      userId: link.userId,
      ipAddress: ip,
      userAgent: userAgent,
      device: deviceInfo.device,
      browser: deviceInfo.browser,
      os: deviceInfo.os,
      country: countries[countryCode] ? countries[countryCode].name : 'Unknown',
      countryCode: countryCode,
      city: '',
      region: '',
      referrer: referrer,
      isBot: isBotUser,
      createdAt: new Date().toISOString()
    };

    data.clicks.push(click);
    data.counters.clickId = newId;

    if (!isBotUser) {
      link.clicks = (link.clicks || 0) + 1;
      const user = data.users.find(u => u.id === link.userId);
      if (user) user.totalClicks = (user.totalClicks || 0) + 1;
    }

    writeData(data);
    if (isSocialPreviewBot(userAgent)) return renderSocialPreview(req, res, link);
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, link.originalUrl);
  } catch (error) {
    console.error('Redirect error:', error);
    res.status(500).send('Error redirecting');
  }
});

// ===== UPDATE LINK =====
app.post('/update-link/:id', authMiddleware, (req, res) => {
  try {
    const data = readData();
    const linkId = parseInt(req.params.id);
    const link = data.links.find(l => l.id === linkId && l.userId === req.user.id);
    
    if (!link) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Link not found'));
    }

    const { newUrl } = req.body;
    if (!newUrl) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Please enter a URL'));
    }

    try {
      new URL(newUrl);
    } catch (e) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Invalid URL format'));
    }

    link.originalUrl = newUrl;
    link.updatedAt = new Date().toISOString();
    writeData(data);

    res.redirect('/dashboard?success=' + encodeURIComponent('Link updated successfully!'));
  } catch (error) {
    console.error('Update error:', error);
    res.redirect('/dashboard?error=' + encodeURIComponent('Failed to update link'));
  }
});

// ===== TOGGLE LINK =====
app.post('/toggle-link/:id', authMiddleware, (req, res) => {
  try {
    const data = readData();
    const linkId = parseInt(req.params.id);
    const link = data.links.find(l => l.id === linkId && l.userId === req.user.id);
    
    if (!link) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Link not found'));
    }

    link.isActive = !link.isActive;
    link.updatedAt = new Date().toISOString();
    writeData(data);

    res.redirect('/dashboard?success=' + encodeURIComponent('Link toggled successfully!'));
  } catch (error) {
    console.error('Toggle error:', error);
    res.redirect('/dashboard?error=' + encodeURIComponent('Failed to toggle link'));
  }
});

// ===== DELETE LINK =====
app.post('/delete-link/:id', authMiddleware, (req, res) => {
  try {
    const data = readData();
    const linkId = parseInt(req.params.id);
    const linkIndex = data.links.findIndex(l => l.id === linkId && l.userId === req.user.id);
    
    if (linkIndex === -1) {
      return res.redirect('/dashboard?error=' + encodeURIComponent('Link not found'));
    }

    data.links.splice(linkIndex, 1);
    const user = data.users.find(u => u.id === req.user.id);
    if (user) user.totalLinks = Math.max(0, (user.totalLinks || 0) - 1);
    writeData(data);

    res.redirect('/dashboard?success=' + encodeURIComponent('Link deleted successfully!'));
  } catch (error) {
    console.error('Delete error:', error);
    res.redirect('/dashboard?error=' + encodeURIComponent('Failed to delete link'));
  }
});

// ===== QR CODE =====
app.get('/qr/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const data = readData();
    const link = data.links.find(l => l.shortCode === code || l.customSlug === code);

    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const baseUrl = getBaseUrl(req);
    const url = baseUrl + '/' + (link.customSlug || link.shortCode);

    const qrCode = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      scale: 8,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.json({ qr: qrCode, url: url });
  } catch (error) {
    console.error('QR error:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// ===== API: USER DATA =====
app.get('/api/user-data', authMiddleware, (req, res) => {
  try {
    const data = readData();
    const user = data.users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const links = data.links.filter(l => l.userId === user.id);
    const clicks = data.clicks.filter(c => c.userId === user.id && !c.isBot);

    let completion = 0;
    const fields = ['displayName', 'email', 'username', 'firstName', 'lastName'];
    let filled = 0;
    for (const field of fields) {
      if (user[field] && user[field] !== '') filled++;
    }
    completion = Math.round((filled / fields.length) * 100);

    res.json({
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      email: user.email,
      profilePhoto: user.profilePhoto,
      timezone: user.timezone,
      accountStatus: user.accountStatus,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      totalLinks: links.length,
      totalClicks: clicks.length,
      completion: completion,
      isAdmin: user.isAdmin
    });
  } catch (error) {
    console.error('User data error:', error);
    res.status(500).json({ error: 'Failed to load user data' });
  }
});

// ===== API: UPDATE PROFILE =====
app.post('/api/update-profile', authMiddleware, (req, res) => {
  try {
    const data = readData();
    const user = data.users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates = req.body;
    const allowed = ['firstName', 'lastName', 'displayName', 'email', 'profilePhoto', 'timezone'];

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        user[key] = updates[key];
      }
    }

    if (updates.firstName && !updates.lastName) {
      user.displayName = updates.firstName + (user.lastName ? ' ' + user.lastName : '');
    } else if (updates.firstName && updates.lastName) {
      user.displayName = updates.firstName + ' ' + updates.lastName;
    } else if (updates.displayName) {
      user.displayName = updates.displayName;
    }

    const onlineUser = data.onlineUsers.find(u => u.id === user.id);
    if (onlineUser) {
      onlineUser.displayName = user.displayName;
      onlineUser.username = user.username;
    }

    writeData(data);

    req.session.user.displayName = user.displayName;
    req.session.user.firstName = user.firstName;
    req.session.user.email = user.email;
    req.session.user.profilePhoto = user.profilePhoto;
    req.session.user.timezone = user.timezone;

    res.json({
      success: true,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
        email: user.email,
        profilePhoto: user.profilePhoto,
        timezone: user.timezone
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ===== API: UPDATE TIMEZONE =====
app.post('/api/update-timezone', authMiddleware, (req, res) => {
  try {
    const { timezone } = req.body;
    if (!timezone) {
      return res.status(400).json({ error: 'Timezone is required' });
    }

    const data = readData();
    const user = data.users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.timezone = timezone;
    writeData(data);

    req.session.user.timezone = timezone;

    res.json({ success: true, timezone: timezone });
  } catch (error) {
    console.error('Update timezone error:', error);
    res.status(500).json({ error: 'Failed to update timezone' });
  }
});

// ===== API: ONLINE USERS =====
app.get('/api/online-users', (req, res) => {
  try {
    const data = readData();
    const now = Date.now();
    const activeUsers = data.onlineUsers.filter(u => (now - u.lastSeen) < 5 * 60 * 1000);
    
    if (activeUsers.length !== data.onlineUsers.length) {
      data.onlineUsers = activeUsers;
      writeData(data);
    }

    const userNames = activeUsers.map(u => ({
      name: u.displayName || u.username || 'User'
    }));

    res.json({
      count: activeUsers.length,
      users: userNames
    });
  } catch (error) {
    console.error('Online users error:', error);
    res.json({ count: 0, users: [] });
  }
});

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    domains: AVAILABLE_DOMAINS,
    baseUrl: BASE_URL,
    uptime: process.uptime()
  });
});

// ===== 404 ERROR HANDLER =====
app.use((req, res) => {
  res.status(404).render('index', {
    page: '404',
    user: req.session?.user || null,
    onlineUsers: 0,
    onlineUserList: [],
    countries: countries,
    error: 'Page not found',
    success: null,
    info: null,
    shortUrl: null,
    customDomains: CUSTOM_DOMAINS,
    baseUrl: getBaseUrl(req)
  });
});

// ===== START SERVER =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Base URL: ${BASE_URL}`);
  console.log('🌐 Custom Domains:');
  CUSTOM_DOMAINS.forEach((domain, i) => {
    console.log(`   ${i + 1}. https://${domain}`);
  });
  console.log(`✅ Health check: ${BASE_URL}/health`);
  console.log(`🔐 Login page: ${BASE_URL}/login`);
  console.log(`📊 Dashboard: ${BASE_URL}/dashboard`);
});
