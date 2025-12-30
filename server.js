const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const routes = require('./routes');
const database = require('./database');

// 创建Express应用
const app = express();

// 安全中间件
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:"]
    }
  }
}));

// CORS配置
app.use(cors({
  origin: config.server.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 请求日志
app.use(morgan(config.server.env === 'development' ? 'dev' : 'combined'));

// 请求体解析
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 速率限制
const limiter = rateLimit({
  windowMs: config.server.rateLimit.windowMs,
  max: config.server.rateLimit.max,
  message: { error: '请求过于频繁，请稍后再试' }
});
app.use('/api/', limiter);

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// API路由
app.use('/', routes);

// 首页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 管理页面路由
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: '请求的资源不存在' 
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ 
    success: false, 
    error: config.server.env === 'development' ? err.message : '服务器内部错误',
    ...(config.server.env === 'development' && { stack: err.stack })
  });
});

// 数据库连接
async function connectDatabase() {
  try {
    await database.connect();
    console.log('✅ 数据库连接成功');
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    process.exit(1);
  }
}

// 启动服务器（仅在本地开发环境）
async function startServer() {
  try {
    // 连接数据库
    await connectDatabase();
    
    // 启动服务器
    const server = app.listen(config.server.port, () => {
      console.log(`🚀 服务器启动成功`);
      console.log(`📡 地址: http://localhost:${config.server.port}`);
      console.log(`📊 管理页面: http://localhost:${config.server.port}/admin`);
      console.log(`🔧 环境: ${config.server.env}`);
    });

     // 优雅关闭
    const gracefulShutdown = async () => {
      console.log('🛑 收到关闭信号，正在优雅关闭...');
      
      server.close(async () => {
        console.log('✅ HTTP服务器已关闭');
        
        await database.disconnect();
        console.log('✅ 数据库连接已关闭');
        
        process.exit(0);
      });
      
      // 如果10秒后还没关闭，强制退出
      setTimeout(() => {
        console.error('❌ 强制关闭服务器');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
    
  } catch (error) {
    console.error('❌ 启动服务器失败:', error);
    process.exit(1);
  }
}

// 只在本地开发环境启动服务器
if (process.env.NODE_ENV === 'development' || !process.env.VERCEL) {
  startServer();
} else {
  // Vercel环境下，确保数据库连接
  connectDatabase().catch(error => {
    console.error('❌ Vercel环境下数据库连接失败:', error);
  });
}

module.exports = app;