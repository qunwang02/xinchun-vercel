require('dotenv').config();

const config = {
  mongodb: {
    uri: process.env.MONGODB_URI,
    database: process.env.DATABASE_NAME || 'donation_system',
    options: {
      serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true,
      }
    }
  },
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX) || 100
    }
  },
  security: {
    jwtSecret: process.env.JWT_SECRET || 'donation_system_secret_key',
    // ⚠️ 管理员密码：必须通过环境变量设置
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123'
  }
};

if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  警告：未设置 ADMIN_PASSWORD 环境变量，正在使用默认密码 admin123');
  console.warn('⚠️  生产环境请在 Vercel 控制台设置 ADMIN_PASSWORD！');
}

module.exports = config;
