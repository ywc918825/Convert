const axios = require('axios');

// 从环境变量安全读取 MinerU API 令牌 (不硬编码在代码中，保障安全)
// 若未设置，回退使用 Agent 轻量 API，此接口免Token但有限制 (10MB/20页)
const MINERU_TOKEN = process.env.MINERU_TOKEN || 'agent';
const BASE_API_URL = 'https://mineru.net/api/v4';

// 允许前端跨域访问
const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  return await fn(req, res);
};

module.exports = allowCors(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: '仅支持 POST 请求' });
  }

  try {
    const { fileUrl, fileName, targetFormat } = req.body;
    if (!fileUrl) {
      return res.status(400).json({ success: false, message: '请提供文件' });
    }
    
    // 默认输出格式为 .docx
    const format = targetFormat || 'docx';

    console.log(`开始转换任务: ${fileName || fileUrl} => .${format}`);

    // ----- 调用 MinerU API -----
    // 1. 提交解析任务
    const taskResponse = await axios.post(`${BASE_API_URL}/extract/task`, {
      url: fileUrl,
      checksum: '', // 通常留空即可
      content: JSON.stringify({ file_name: fileName || 'document.pdf' }),
    }, {
      headers: {
        'Content-Type': 'application/json',
        ...(MINERU_TOKEN !== 'agent' && { 'Authorization': `Bearer ${MINERU_TOKEN}` })
      }
    });
    
    if (taskResponse.data.status !== 'success') {
      throw new Error(taskResponse.data.message || '提交任务失败');
    }
    
    const taskId = taskResponse.data.data.task_id;
    
    // 2. 轮询任务状态
    const getTaskResult = async (taskId) => {
      const response = await axios.get(`${BASE_API_URL}/extract/task/${taskId}`, {
        headers: {
          ...((MINERU_TOKEN !== 'agent') && { 'Authorization': `Bearer ${MINERU_TOKEN}` })
        }
      });
      return response.data;
    };
    
    let taskResult = await getTaskResult(taskId);
    let retries = 0;
    const maxRetries = 30;

    while (taskResult.data.task_status !== 'done' && retries < maxRetries) {
      // 处理失败状态
      if (taskResult.data.task_status === 'failed') {
        throw new Error('转换任务失败');
      }
      // 等待 2 秒后重试
      await new Promise(resolve => setTimeout(resolve, 2000));
      taskResult = await getTaskResult(taskId);
      retries++;
    }
    
    if (taskResult.data.task_status !== 'done') {
      throw new Error('转换任务超时，请稍后重试');
    }
    
    // 3. 获取下载链接
    const downloadUrl = taskResult.data.download_url;
    
    return res.json({
      success: true,
      downloadUrl: downloadUrl,
      taskId: taskId,
    });
  } catch (error) {
    console.error('转换失败:', error.message);
    return res.status(500).json({
      success: false,
      message: error.message || '内部服务器错误',
    });
  }
});
