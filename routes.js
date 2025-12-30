const express = require('express');
const router = express.Router();
const database = require('./database');
const { ObjectId } = require('mongodb');

// 健康检查
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
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 测试连接
router.get('/api/test', async (req, res) => {
  try {
    await database.connect();
    res.json({ 
      success: true, 
      message: '服务器连接正常',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// 提交捐赠数据
router.post('/api/donations', async (req, res) => {
  try {
    await database.connect();
    const donationsCollection = database.donations();
    
    const { data, batchId, deviceId } = req.body;
    
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ 
        success: false, 
        error: '无效的数据格式' 
      });
    }
    
    // 为每条数据添加时间戳和状态
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
    
    // 批量插入数据
    const result = await donationsCollection.insertMany(donationsWithMetadata);
    
    // 记录操作日志
    await database.logs().insertOne({
      type: 'donation_submit',
      batchId: batchId,
      count: donationsWithMetadata.length,
      deviceId: deviceId,
      timestamp: new Date(),
      ip: req.ip
    });
    
    res.json({
      success: true,
      message: `成功提交 ${result.insertedCount} 条数据`,
      submittedCount: result.insertedCount,
      batchId: batchId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('提交数据错误:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 获取所有捐赠数据（支持分页和筛选）
router.get('/api/donations', async (req, res) => {
  try {
    await database.connect();
    const donationsCollection = database.donations();
    
    // 查询参数
    const { 
      page = 1, 
      limit = 50, 
      sortBy = 'submittedAt', 
      sortOrder = 'desc',
      search = '',
      project = '',
      payment = '',
      startDate = '',
      endDate = ''
    } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // 构建查询条件
    const query = {};
    
    // 搜索条件
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }
    
    // 项目筛选
    if (project) {
      query.project = project;
    }
    
    // 缴费状态筛选
    if (payment) {
      query.payment = payment;
    }
    
    // 日期范围筛选
    if (startDate || endDate) {
      query.submittedAt = {};
      if (startDate) {
        query.submittedAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.submittedAt.$lte = new Date(endDate);
      }
    }
    
    // 执行查询
    const [donations, totalCount] = await Promise.all([
      donationsCollection
        .find(query)
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray(),
      donationsCollection.countDocuments(query)
    ]);
    
    // 获取统计信息
    const stats = await donationsCollection.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalAmountTWD: { $sum: '$amountTWD' },
          totalAmountRMB: { $sum: '$amountRMB' },
          count: { $sum: 1 }
        }
      }
    ]).toArray();
    
    res.json({
      success: true,
      data: donations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      },
      stats: stats[0] || { totalAmountTWD: 0, totalAmountRMB: 0, count: 0 }
    });
    
  } catch (error) {
    console.error('获取数据错误:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 获取统计数据
router.get('/api/stats', async (req, res) => {
  try {
    await database.connect();
    const donationsCollection = database.donations();
    
    // 总体统计
    const overallStats = await donationsCollection.aggregate([
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalAmountTWD: { $sum: '$amountTWD' },
          totalAmountRMB: { $sum: '$amountRMB' },
          avgAmountTWD: { $avg: '$amountTWD' },
          avgAmountRMB: { $avg: '$amountRMB' }
        }
      }
    ]).toArray();
    
    // 按项目统计
    const projectStats = await donationsCollection.aggregate([
      {
        $group: {
          _id: '$project',
          count: { $sum: 1 },
          totalAmountTWD: { $sum: '$amountTWD' },
          totalAmountRMB: { $sum: '$amountRMB' }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();
    
    // 按缴费状态统计
    const paymentStats = await donationsCollection.aggregate([
      {
        $group: {
          _id: '$payment',
          count: { $sum: 1 },
          totalAmountTWD: { $sum: '$amountTWD' },
          totalAmountRMB: { $sum: '$amountRMB' }
        }
      }
    ]).toArray();
    
    // 按日期统计（最近30天）
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const dailyStats = await donationsCollection.aggregate([
      {
        $match: {
          submittedAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$submittedAt' }
          },
          count: { $sum: 1 },
          totalAmountTWD: { $sum: '$amountTWD' },
          totalAmountRMB: { $sum: '$amountRMB' }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();
    
    res.json({
      success: true,
      overall: overallStats[0] || {
        totalRecords: 0,
        totalAmountTWD: 0,
        totalAmountRMB: 0,
        avgAmountTWD: 0,
        avgAmountRMB: 0
      },
      byProject: projectStats,
      byPayment: paymentStats,
      daily: dailyStats,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('获取统计错误:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 删除数据（需要管理员权限）
router.delete('/api/donations/:id', async (req, res) => {
  try {
    const { adminPassword } = req.query;
    const config = require('./config');
    
    // 简单的密码验证
    if (adminPassword !== config.security.adminPassword) {
      return res.status(401).json({ 
        success: false, 
        error: '未授权的操作' 
      });
    }
    
    await database.connect();
    const donationsCollection = database.donations();
    
    const { id } = req.params;
    
    let result;
    if (id === 'batch' && req.query.batchId) {
      // 批量删除
      result = await donationsCollection.deleteMany({ batchId: req.query.batchId });
    } else if (id === 'all' && adminPassword) {
      // 删除所有数据（危险操作）
      result = await donationsCollection.deleteMany({});
    } else {
      // 删除单条数据
      result = await donationsCollection.deleteOne({ 
        $or: [
          { _id: new ObjectId(id) },
          { localId: id },
          { serverId: id }
        ]
      });
    }
    
    // 记录日志
    await database.logs().insertOne({
      type: 'donation_delete',
      targetId: id,
      deletedCount: result.deletedCount,
      timestamp: new Date(),
      ip: req.ip
    });
    
    res.json({
      success: true,
      message: `成功删除 ${result.deletedCount} 条数据`,
      deletedCount: result.deletedCount
    });
    
  } catch (error) {
    console.error('删除数据错误:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 导出数据为CSV
router.get('/api/export/csv', async (req, res) => {
  try {
    await database.connect();
    const donationsCollection = database.donations();
    
    const donations = await donationsCollection
      .find({})
      .sort({ submittedAt: -1 })
      .toArray();
    
    // 构建CSV内容
    const headers = [
      '序号', '姓名', '护持项目', '祈福方式', 
      '护持金额(新台币)', '护持金额(人民币)', 
      '祈福内容', '是否缴费', '联系人', 
      '提交时间', '设备ID', '批次ID', '本地ID'
    ];
    
    let csvContent = '\uFEFF'; // BOM for UTF-8
    csvContent += headers.join(',') + '\n';
    
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
    
    // 设置响应头
    const timestamp = new Date().toISOString().slice(0,10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=donations_${timestamp}_${donations.length}.csv`);
    
    res.send(csvContent);
    
  } catch (error) {
    console.error('导出CSV错误:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;