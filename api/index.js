try {
  const app = require('../server/server');
  module.exports = app;
} catch (err) {
  console.error('❌ 加载 server.js 失败:', err.stack);
  throw err;
}
