const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs');
const QRCode = require('qrcode');

require('dotenv').config();

const app = express();

// ===== CONFIGURATION =====
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'your-secret-key';

// 5 Custom Domains
const CUSTOM_DOMAINS = [
  process.env.DOMAIN_1 || 'thispersonisbrandshortner.xyz',
  process.env.DOMAIN_2 || 'thispersonisbrandshortner1.xyz',
  process.env.DOMAIN_3 || 'thispersonisbrandshortne2.xyz',
  process.env.DOMAIN_4 || 'clcikauto.xyz',
  process.env.DOMAIN_5 || 'clickautoshortner.xyz'
];

const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ===== JSON FILE STORAGE =====
const DATA_FILE = './data.json';

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    users: [],
    links: [],
    clicks: [],
    onlineUsers: [],
    counters: {
      linkId: 1,
      clickId: 1
    }
  }, null, 2));
}

function readData() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading data file:', error);
    return { users: [], links: [], clicks: [], onlineUsers: [], counters: { linkId: 1, clickId: 1 } };
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing data file:', error);
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
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Session
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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

function getBaseUrl(req) {
  // Check if request came from one of our custom domains
  const host = req.get('host') || '';
  for (const domain of CUSTOM_DOMAINS) {
    if (host.includes(domain)) {
      return `https://${domain}`;
    }
  }
  return BASE_URL;
}

// ===== AUTH MIDDLEWARE =====
function authMiddleware(req, res, next) {
  if (req.session.user) {
    const data = readData();
    const user = data.users.find(u => u.id === req.session.user.id);
    if (user) {
      req.user = user;
      return next();
    }
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

// ===== ROUTES =====
app.get('/', async (req, res) => {
  try {
    const user = req.session.user || null;
    const data = readData();
    const onlineUsers = data.onlineUsers || [];
    
    // Clean up stale online users (older than 5 minutes)
    const now = Date.now();
    const activeUsers = onlineUsers.filter(u => (now - u.lastSeen) < 5 * 60 * 1000);
    if (activeUsers.length !== onlineUsers.length) {
      data.onlineUsers = activeUsers;
      writeData(data);
    }

    const userNames = activeUsers.map(u => ({ name: u.displayName || u.username || 'User' }));

    res.render('index', {
      page: 'home',
      user: user,
      onlineUsers: activeUsers.length,
      onlineUserList: userNames,
      countries: countries,
      error: null,
      success: null,
      info: null,
      shortUrl: null,
      customDomains: CUSTOM_DOMAINS,
      baseUrl: getBaseUrl(req)
    });
  } catch (error) {
    console.error('Home error:', error);
    res.render('index', {
      page: 'home',
      user: null,
      onlineUsers: 0,
      onlineUserList: [],
      countries: countries,
      error: 'Error loading page',
      success: null,
      info: null,
      shortUrl: null,
      customDomains: CUSTOM_DOMAINS,
      baseUrl: getBaseUrl(req)
    });
  }
});

app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('index', {
    page: 'login',
    user: null,
    onlineUsers: 0,
    onlineUserList: [],
    countries: countries,
    error: null,
    success: null,
    info: null,
    shortUrl: null,
    customDomains: CUSTOM_DOMAINS,
    baseUrl: getBaseUrl(req)
  });
});

app.post('/login', async (req, res) => {
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
        baseUrl: getBaseUrl(req)
      });
    }

    const data = readData();
    let user = data.users.find(u => u.telegramId === telegramId);
    
    if (!user) {
      const newId = data.counters.userId ? data.counters.userId + 1 : 1;
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
      if (!data.counters) data.counters = {};
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
      
      // Update online status
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

    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(returnTo);
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
      baseUrl: getBaseUrl(req)
    });
  }
});

app.post('/logout', (req, res) => {
  // Remove from online users
  if (req.session.user) {
    const data = readData();
    data.onlineUsers = data.onlineUsers.filter(u => u.id !== req.session.user.id);
    writeData(data);
  }
  req.session.destroy((err) => {
    res.redirect('/');
  });
});

app.post('/shorten', authMiddleware, async (req, res) => {
  try {
    const { originalUrl, customSlug, expiresIn } = req.body;
    const baseUrl = getBaseUrl(req);
    
    if (!originalUrl) {
      return res.redirect('/?error=' + encodeURIComponent('Please enter a URL'));
    }

    // Validate URL
    try {
      new URL(originalUrl);
    } catch (e) {
      return res.redirect('/?error=' + encodeURIComponent('Invalid URL format'));
    }

    const data = readData();
    let shortCode = generateShortCode();
    
    if (customSlug) {
      const existing = data.links.find(l => l.shortCode === customSlug);
      if (existing) {
        return res.redirect('/?error=' + encodeURIComponent('Custom slug already taken'));
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

    const newId = data.counters.linkId ? data.counters.linkId + 1 : 1;
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
      updatedAt: new Date().toISOString()
    };

    data.links.push(link);
    data.counters.linkId = newId;
    
    // Update user total links
    const user = data.users.find(u => u.id === req.user.id);
    if (user) user.totalLinks = (user.totalLinks || 0) + 1;
    
    writeData(data);

    const shortUrl = baseUrl + '/' + shortCode;

    res.redirect('/?success=' + encodeURIComponent('Link created successfully!') + '&shortUrl=' + encodeURIComponent(shortUrl));
  } catch (error) {
    console.error('Shorten error:', error);
    res.redirect('/?error=' + encodeURIComponent('Failed to create short link: ' + error.message));
  }
});

app.get('/dashboard', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const data = readData();
    const links = data.links.filter(l => l.userId === user.id).sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    
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

    // Get all clicks for user's links
    const userLinkIds = links.map(l => l.id);
    const clicks = data.clicks.filter(c => userLinkIds.includes(c.linkId));

    // Country stats
    const countryMap = {};
    const deviceMap = {};
    const weekData = [0, 0, 0, 0, 0, 0, 0];

    for (const click of clicks) {
      if (!click.isBot) {
        totalClicks++;
        
        // Today
        const clickDate = new Date(click.createdAt);
        if (clickDate >= today) todayClicks++;
        
        // Week
        if (clickDate >= weekAgo) {
          weekClicks++;
          const dayIndex = clickDate.getDay();
          const adjustedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
          weekData[adjustedIndex]++;
        }
        
        // Month
        if (clickDate >= monthAgo) monthClicks++;
        
        // Country
        const countryCode = click.countryCode || 'XX';
        if (!countryMap[countryCode]) countryMap[countryCode] = 0;
        countryMap[countryCode]++;
        
        // Device
        const deviceKey = click.device + '|' + click.browser + '|' + click.os;
        if (!deviceMap[deviceKey]) deviceMap[deviceKey] = { device: click.device, browser: click.browser, os: click.os, count: 0 };
        deviceMap[deviceKey].count++;
      } else {
        botClicks++;
      }
    }

    realClicks = totalClicks;
    const clickRate = (totalClicks + botClicks) > 0 ? Math.round((totalClicks / (totalClicks + botClicks)) * 100) : 0;

    // Format country stats
    const countryStats = Object.entries(countryMap)
      .map(([code, count]) => ({ countryCode: code, count: count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Format device stats
    const deviceStats = Object.values(deviceMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const onlineUsers = data.onlineUsers || [];

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
      onlineUserList: [],
      error: null,
      success: null,
      info: null,
      shortUrl: null,
      customDomains: CUSTOM_DOMAINS,
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
      baseUrl: getBaseUrl(req)
    });
  }
});

app.get('/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const data = readData();
    
    const link = data.links.find(l => 
      (l.shortCode === code || l.customSlug === code) && l.isActive === true
    );

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

    // Get country from IP (simplified - using geoip-lite)
    let countryCode = 'XX';
    try {
      const geo = require('geoip-lite');
      const geoData = geo.lookup(ip);
      if (geoData && geoData.country) {
        countryCode = geoData.country;
      }
    } catch (e) {}

    // Save click
    const newId = data.counters.clickId ? data.counters.clickId + 1 : 1;
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

    // Redirect to original URL
    res.redirect(link.originalUrl);
  } catch (error) {
    console.error('Redirect error:', error);
    res.status(500).send('Error redirecting');
  }
});

app.post('/update-link/:id', authMiddleware, async (req, res) => {
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

app.post('/toggle-link/:id', authMiddleware, async (req, res) => {
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

app.post('/delete-link/:id', authMiddleware, async (req, res) => {
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

app.get('/api/user-data', authMiddleware, async (req, res) => {
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

app.post('/api/update-profile', authMiddleware, async (req, res) => {
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

    // Update online users list
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

app.post('/api/update-timezone', authMiddleware, async (req, res) => {
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

app.get('/api/online-users', async (req, res) => {
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

// Update online status on each request
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    const data = readData();
    const onlineUser = data.onlineUsers.find(u => u.id === req.session.user.id);
    if (onlineUser) {
      onlineUser.lastSeen = Date.now();
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

// Cleanup expired links (daily at midnight)
cron.schedule('0 0 * * *', async () => {
  try {
    const data = readData();
    let count = 0;
    for (const link of data.links) {
      if (!link.isExpired && link.expiresAt && new Date(link.expiresAt) < new Date()) {
        link.isExpired = true;
        count++;
      }
    }
    if (count > 0) {
      writeData(data);
      console.log(`Expired ${count} links`);
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Base URL: ${BASE_URL}`);
  console.log(`🌐 Custom Domains:`);
  CUSTOM_DOMAINS.forEach((domain, i) => {
    console.log(`   ${i + 1}. https://${domain}`);
  });
});
