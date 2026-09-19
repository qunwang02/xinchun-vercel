const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const routes = require('./routes');
const database = require('./database');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "*"]
    }
  }
}));

app.use(cors({
  origin: config.server.corsOrigin,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','x-admin-password']
}));

app.use(morgan(config.server.env === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const limiter = rateLimit({
  windowMs: config.server.rateLimit.windowMs,
  max: config.server.rateLimit.max,
  message: { error: '请求过于频繁，请稍后再试' }
});
app.use('/api/', limiter);

// 静态文件
app.use(express.static(path.join(__dirname, '../public')));

// API 路由
app.use('/', routes);

// 页面路由
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/mobile', (req, res) => res.sendFile(path.join(__dirname, '../public/mobile.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: '请求的资源不存在' });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    error: config.server.env === 'development' ? err.message : '服务器内部错误'
  });
});

async function connectDatabase() {
  try {
    await database.connect();
    console.log('✅ 数据库连接成功');
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
      process.exit(1);
    }
  }
}

async function startServer() {
  await connectDatabase();
  const server = app.listen(config.server.port, () => {
    console.log(`🚀 服务器启动成功`);
    console.log(`📡 http://localhost:${config.server.port}`);
    console.log(`📊 管理页面: http://localhost:${config.server.port}/admin.html`);
    console.log(`🔧 环境: ${config.server.env}`);
  });

  const gracefulShutdown = async () => {
    console.log('🛑 收到关闭信号...');
    server.close(async () => {
      await database.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

if (!process.env.VERCEL) {
  startServer();
} else {
  connectDatabase().catch(err => console.error('Vercel数据库连接失败:', err));
}

module.exports = app;