const express = require('express');
const router = express.Router();
const database = require('./database');
const config = require('./config');
const { ObjectId } = require('mongodb');

// ============ 内联默认活动配置 ============
// ⭐ 保证 API 永远返回项目数据，不依赖数据库或文件系统
const DEFAULT_CONFIG = {
  exchangeRate: 4.2,
  projects: {
    "供灯祈福(总功德主)": {
      method: "1.供灯祈福共修 (七天)\n2.附 福慧灯 三盏\n3.附 常年光明灯 三盏",
      amount: "300000"
    },
    "供灯祈福(副总功德主)": {
      method: "1.供灯祈福共修 (七天)\n2.附 福慧灯 二盏\n3.附 常年光明灯 二盏",
      amount: "80000"
    },
    "供灯祈福(圆满功德主)": {
      method: "1.供灯祈福共修 (七天)\n2.附 福慧灯 一盏\n3.附 常年光明灯 一盏",
      amount: "50000"
    },
    "供灯祈福(阖家福慧功德主)": {
      method: "1.供灯祈福共修 (七天)\n2.附 常年光明灯 一盏",
      amount: "8000"
    },
    "供灯祈福(个人福慧功德主)": {
      method: "1.供灯祈福共修 (七天)\n2.附 常年光明灯 一盏",
      amount: "6000"
    },
    "常年光明灯（阖家光明灯功德主）": {
      method: "佛龛供灯一年",
      amount: "1000"
    },
    "常年光明灯(个人光明灯功德主)": {
      method: "佛龛供灯一年",
      amount: "600"
    },
    "新春祈福单(随喜功德主)": {
      method: "祈福共修 (三天)",
      amount: "随喜"
    }
  }
};

// ============ 健康检查 ============
router.get('/health', async (req, res) => {
  try {
    await database.connect();
    await database.db.command({ ping: 1 });
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

router.get('/api/test', async (req, res) => {
  try {
    await database.connect();
    res.json({ success: true, message: '服务器连接正常', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ 管理员登录验证 ============
router.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!config.security.adminPassword) {
    return res.status(500).json({ success: false, error: '服务器未配置管理员密码' });
  }
  if (password === config.security.adminPassword) {
    res.json({ success: true, message: '登录成功' });
  } else {
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

// 中间件：校验管理员密码
function requireAdmin(req, res, next) {
  const pwd = req.query.adminPassword || req.body.adminPassword || req.headers['x-admin-password'];
  if (pwd !== config.security.adminPassword) {
    return res.status(401).json({ success: false, error: '未授权的操作' });
  }
  next();
}

// ============ 活动项目配置 ============
// 获取配置（无需密码，前端展示用）
router.get('/api/config', async (req, res) => {
  try {
    await database.connect();
    const doc = await database.configs().findOne({ _id: 'project_config' });

    // ⭐ 关键：数据库里有配置，且 projects 不为空，才用数据库的
    if (doc && doc.projects && Object.keys(doc.projects).length > 0) {
      return res.json({ success: true, config: doc });
    }

    // 数据库没有 or 数据库的 projects 是空的 → 用内联默认配置并回写数据库
    try {
      await database.configs().updateOne(
        { _id: 'project_config' },
        { $set: { ...DEFAULT_CONFIG, _id: 'project_config', updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (writeErr) {
      console.warn('写入默认配置失败:', writeErr.message);
    }

    res.json({ success: true, config: DEFAULT_CONFIG });
  } catch (error) {
    console.error('获取配置错误，返回默认配置:', error.message);
    // ⭐ 即使数据库完全挂了也返回默认配置，保证前端可用
    res.json({ success: true, config: DEFAULT_CONFIG });
  }
});

// 保存配置（需管理员密码）
router.post('/api/config', requireAdmin, async (req, res) => {
  try {
    const { configData } = req.body;
    if (!configData || typeof configData !== 'object') {
      return res.status(400).json({ success: false, error: '配置数据格式错误' });
    }
    await database.connect();
    await database.configs().updateOne(
      { _id: 'project_config' },
      { $set: { ...configData, _id: 'project_config', updatedAt: new Date() } },
      { upsert: true }
    );
    await database.logs().insertOne({
      type: 'config_update', timestamp: new Date(), ip: req.ip
    });
    res.json({ success: true, message: '配置已保存' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ 提交捐赠数据 ============
router.post('/api/donations', async (req, res) => {
  try {
    await database.connect();
    const donationsCollection = database.donations();
    const { data, batchId, deviceId } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ success: false, error: '无效的数据格式' });
    }

    const donationsWithMetadata = data.map(item => ({
      ...item,
      batchId: batchId || `batch_${Date.now()}`,
      deviceId: deviceId || 'unknown',
      submittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      syncStatus: 'synced',
      serverId: new ObjectId().toString()
    }));

    const result = await donationsCollection.insertMany(donationsWithMetadata);

    await database.logs().insertOne({
      type: 'donation_submit',
      batchId, count: donationsWithMetadata.length,
      deviceId, timestamp: new Date(), ip: req.ip
    });

    res.json({
      success: true,
      message: `成功提交 ${result.insertedCount} 条数据`,
      submittedCount: result.insertedCount,
      batchId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('提交数据错误:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ 获取捐赠数据 ============
router.get('/api/donations', async (req, res) => {
  try {
    await database.connect();
    const donationsCollection = database.donations();
    const {
      page = 1, limit = 50, sortBy = 'submittedAt', sortOrder = 'desc',
      search = '', project = '', payment = '', startDate = '', endDate = ''
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }
    if (project) query.project = project;
    if (payment) query.payment = payment;
    if (startDate || endDate) {
      query.submittedAt = {};
      if (startDate) query.submittedAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.submittedAt.$lte = end;
      }
    }

    const [donations, totalCount] = await Promise.all([
      donationsCollection.find(query)
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip).limit(parseInt(limit)).toArray(),
      donationsCollection.countDocuments(query)
    ]);

    const stats = await donationsCollection.aggregate([
      { $match: query },
      { $group: {
        _id: null,
        totalAmountTWD: { $sum: '$amountTWD' },
        totalAmountRMB: { $sum: '$amountRMB' },
        count: { $sum: 1 }
      }}
    ]).toArray();

    res.json({
      success: true,
      data: donations,
      pagination: {
        page: parseInt(page), limit: parseInt(limit),
        totalCount, totalPages: Math.ceil(totalCount / parseInt(limit))
      },
      stats: stats[0] || { totalAmountTWD: 0, totalAmountRMB: 0, count: 0 }
    });
  } catch (error) {
    console.error('获取数据错误:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ 统计数据 ============
router.get('/api/stats', async (req, res) => {
  try {
    await database.connect();
    const donationsCollection = database.donations();

    const overallStats = await donationsCollection.aggregate([
      { $group: {
        _id: null,
        totalRecords: { $sum: 1 },
        totalAmountTWD: { $sum: '$amountTWD' },
        totalAmountRMB: { $sum: '$amountRMB' },
        avgAmountTWD: { $avg: '$amountTWD' },
        avgAmountRMB: { $avg: '$amountRMB' }
      }}
    ]).toArray();

    const projectStats = await donationsCollection.aggregate([
      { $group: {
        _id: '$project', count: { $sum: 1 },
        totalAmountTWD: { $sum: '$amountTWD' },
        totalAmountRMB: { $sum: '$amountRMB' }
      }},
      { $sort: { count: -1 } }
    ]).toArray();

    const paymentStats = await donationsCollection.aggregate([
      { $group: {
        _id: '$payment', count: { $sum: 1 },
        totalAmountTWD: { $sum: '$amountTWD' },
        totalAmountRMB: { $sum: '$amountRMB' }
      }}
    ]).toArray();

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyStats = await donationsCollection.aggregate([
      { $match: { submittedAt: { $gte: thirtyDaysAgo } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt' } },
        count: { $sum: 1 },
        totalAmountTWD: { $sum: '$amountTWD' },
        totalAmountRMB: { $sum: '$amountRMB' }
      }},
      { $sort: { _id: 1 } }
    ]).toArray();

    res.json({
      success: true,
      overall: overallStats[0] || {
        totalRecords: 0, totalAmountTWD: 0, totalAmountRMB: 0,
        avgAmountTWD: 0, avgAmountRMB: 0
      },
      byProject: projectStats,
      byPayment: paymentStats,
      daily: dailyStats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('获取统计错误:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ 删除数据 ============
router.delete('/api/donations/:id', requireAdmin, async (req, res) => {
  try {
    await database.connect();
    const donationsCollection = database.donations();
    const { id } = req.params;

    let result;
    if (id === 'batch' && req.query.batchId) {
      result = await donationsCollection.deleteMany({ batchId: req.query.batchId });
    } else if (id === 'all') {
      result = await donationsCollection.deleteMany({});
    } else {
      const orConditions = [{ localId: id }, { serverId: id }];
      if (ObjectId.isValid(id)) orConditions.push({ _id: new ObjectId(id) });
      result = await donationsCollection.deleteOne({ $or: orConditions });
    }

    await database.logs().insertOne({
      type: 'donation_delete', targetId: id,
      deletedCount: result.deletedCount,
      timestamp: new Date(), ip: req.ip
    });

    res.json({
      success: true,
      message: `成功删除 ${result.deletedCount} 条数据`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('删除数据错误:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ 导出 CSV ============
router.get('/api/export/csv', async (req, res) => {
  try {
    await database.connect();
    const donations = await database.donations()
      .find({}).sort({ submittedAt: -1 }).toArray();

    const headers = ['序号','姓名','护持项目','祈福方式','护持金额(新台币)',
      '护持金额(人民币)','祈福内容','是否缴费','联系人','提交时间','设备ID','批次ID','本地ID'];

    let csvContent = '\uFEFF' + headers.join(',') + '\n';

    donations.forEach((item, index) => {
      const row = [
        index + 1,
        `"${item.name || ''}"`,
        `"${item.project || ''}"`,
        `"${(item.method || '').replace(/"/g, '""').replace(/\n/g, '; ')}"`,
        item.amountTWD || 0,
        item.amountRMB ? item.amountRMB.toFixed(2) : 0,
        `"${(item.content || '').replace(/"/g, '""')}"`,
        `"${item.payment || ''}"`,
        `"${item.contact || ''}"`,
        item.submittedAt ? new Date(item.submittedAt).toISOString() : '',
        `"${item.deviceId || ''}"`,
        `"${item.batchId || ''}"`,
        `"${item.localId || ''}"`
      ];
      csvContent += row.join(',') + '\n';
    });

    const timestamp = new Date().toISOString().slice(0,10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=donations_${timestamp}_${donations.length}.csv`);
    res.send(csvContent);
  } catch (error) {
    console.error('导出CSV错误:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
