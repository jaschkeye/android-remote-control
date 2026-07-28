const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const LOG_PREFIX = '[AgentEngine]';

class AgentEngine extends EventEmitter {
  constructor(options) {
    super();
    this.adbPath = options.adbPath || 'adb';
    this.serial = options.serial;
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = options.baseUrl || 'https://api.openai.com/v1';
    this.model = options.model || 'gpt-4o';
    this.maxIterations = options.maxIterations || 20;
    this.running = false;
    this.iteration = 0;
  }

  /**
   * 截图，返回 PNG Buffer
   * @returns {Promise<Buffer>}
   */
  captureScreen() {
    return new Promise((resolve, reject) => {
      this._log('Capturing screen...');
      execFile(
        this.adbPath,
        ['-s', this.serial, 'exec-out', 'screencap', '-p'],
        { maxBuffer: 10 * 1024 * 1024, encoding: 'buffer' },
        (error, stdout) => {
          if (error) {
            const msg = `截图失败: ${error.message}`;
            this._log(msg);
            reject(new Error(msg));
            return;
          }
          if (!stdout || stdout.length === 0) {
            const msg = '截图失败: 返回数据为空';
            this._log(msg);
            reject(new Error(msg));
            return;
          }
          this._log(`截图成功, 大小: ${stdout.length} bytes`);
          resolve(stdout);
        }
      );
    });
  }

  /**
   * 截图并转为 base64 字符串
   * @returns {Promise<string>}
   */
  async captureScreenBase64() {
    const buffer = await this.captureScreen();
    return buffer.toString('base64');
  }

  /**
   * 通过 adb shell wm size 获取设备分辨率
   * @returns {Promise<{width: number, height: number}>}
   */
  getScreenSize() {
    return new Promise((resolve, reject) => {
      this._log('Getting screen size...');
      execFile(
        this.adbPath,
        ['-s', this.serial, 'shell', 'wm', 'size'],
        { maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            const msg = `获取屏幕尺寸失败: ${error.message}`;
            this._log(msg);
            reject(new Error(msg));
            return;
          }
          const match = stdout.match(/(\d+)x(\d+)/);
          if (!match) {
            const msg = `解析屏幕尺寸失败: ${stdout.trim()}`;
            this._log(msg);
            reject(new Error(msg));
            return;
          }
          const size = { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
          this._log(`屏幕尺寸: ${size.width}x${size.height}`);
          resolve(size);
        }
      );
    });
  }

  /**
   * 执行一个结构化动作
   * @param {object} action
   * @returns {Promise<{success: boolean, detail: string}>}
   */
  executeAction(action) {
    return new Promise((resolve, reject) => {
      if (!action || !action.type) {
        reject(new Error('无效的动作: 缺少 type 字段'));
        return;
      }

      this._log(`执行动作: ${JSON.stringify(action)}`);

      switch (action.type) {
        case 'tap':
          this._execAdb(['shell', 'input', 'tap', String(action.x), String(action.y)])
            .then(() => resolve({ success: true, detail: `点击 (${action.x}, ${action.y})` }))
            .catch((err) => resolve({ success: false, detail: err.message }));
          break;

        case 'swipe':
          this._execAdb([
            'shell', 'input', 'swipe',
            String(action.x1), String(action.y1),
            String(action.x2), String(action.y2),
            String(action.duration || 300)
          ])
            .then(() => resolve({ success: true, detail: `滑动 (${action.x1},${action.y1}) -> (${action.x2},${action.y2})` }))
            .catch((err) => resolve({ success: false, detail: err.message }));
          break;

        case 'text':
          this._execAdb(['shell', 'input', 'text', action.text])
            .then(() => resolve({ success: true, detail: `输入文字: ${action.text}` }))
            .catch((err) => resolve({ success: false, detail: err.message }));
          break;

        case 'keyevent':
          this._execAdb(['shell', 'input', 'keyevent', String(action.keycode)])
            .then(() => resolve({ success: true, detail: `按键: ${action.keycode}` }))
            .catch((err) => resolve({ success: false, detail: err.message }));
          break;

        case 'longpress':
          this._execAdb([
            'shell', 'input', 'swipe',
            String(action.x), String(action.y),
            String(action.x), String(action.y),
            String(action.duration || 1000)
          ])
            .then(() => resolve({ success: true, detail: `长按 (${action.x}, ${action.y}) ${action.duration || 1000}ms` }))
            .catch((err) => resolve({ success: false, detail: err.message }));
          break;

        case 'wait':
          setTimeout(() => {
            this._log(`等待 ${action.duration}ms`);
            resolve({ success: true, detail: `等待 ${action.duration}ms` });
          }, action.duration || 2000);
          break;

        case 'done':
          resolve({ success: true, detail: action.summary || '任务完成' });
          break;

        default:
          resolve({ success: false, detail: `未知动作类型: ${action.type}` });
          break;
      }
    });
  }

  /**
   * 调用视觉大模型 API 分析当前屏幕，返回下一步动作
   * @param {string} imageBase64
   * @param {string} userGoal
   * @param {Array} history
   * @returns {Promise<object>}
   */
  async analyzeScreen(imageBase64, userGoal, history) {
    this._log('正在分析屏幕...');

    const systemContent = `你是一个 Android 手机操控助手。用户会给你一个任务目标，你需要通过分析手机屏幕截图来决定下一步操作。

你可以执行以下动作（只返回 JSON，不要其他文字）：
- {"type":"tap","x":500,"y":800} - 点击坐标
- {"type":"swipe","x1":500,"y1":1000,"x2":500,"y2":200,"duration":300} - 滑动
- {"type":"text","text":"要输入的文字"} - 输入文字
- {"type":"keyevent","keycode":4} - 按键(3=HOME,4=BACK,66=ENTER,27=电源)
- {"type":"longpress","x":500,"y":800,"duration":1000} - 长按
- {"type":"wait","duration":2000} - 等待
- {"type":"done","summary":"任务完成说明"} - 任务完成

规则：
1. 只返回一个 JSON 对象，不要包含 markdown 标记或解释文字
2. 坐标基于截图的实际像素尺寸
3. 如果任务已完成，返回 done 类型
4. 每次只执行一个动作`;

    const userMessages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: `任务目标: ${userGoal}\n\n这是当前手机屏幕截图，请分析并返回下一步操作。` },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
        ]
      }
    ];

    // 如果有历史记录，作为中间对话添加到 messages 中
    const messages = [
      { role: 'system', content: systemContent }
    ];

    if (history && history.length > 0) {
      for (const entry of history) {
        messages.push({
          role: 'assistant',
          content: JSON.stringify(entry.action)
        });
        messages.push({
          role: 'user',
          content: `动作执行${entry.result && entry.result.success ? '成功' : '失败'}: ${entry.result ? entry.result.detail : ''}\n\n这是当前手机屏幕截图，请分析并返回下一步操作。`
        });
      }
    }

    messages.push(userMessages[0]);

    const requestBody = {
      model: this.model,
      messages: messages,
      max_tokens: 300,
      temperature: 0.1
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        const msg = `API 调用失败 (${response.status}): ${errorText}`;
        this.emit('error', new Error(msg));
        throw new Error(msg);
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        const msg = 'API 返回结果为空: 没有 choices';
        this.emit('error', new Error(msg));
        throw new Error(msg);
      }

      const content = data.choices[0].message.content;
      // 去掉可能的 markdown 标记
      const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      let action;
      try {
        action = JSON.parse(cleaned);
      } catch (parseErr) {
        const msg = `解析 AI 返回的动作失败: ${parseErr.message}, 原始内容: ${content}`;
        this.emit('error', new Error(msg));
        throw new Error(msg);
      }

      if (!action.type) {
        const msg = `AI 返回的动作缺少 type 字段: ${JSON.stringify(action)}`;
        this.emit('error', new Error(msg));
        throw new Error(msg);
      }

      this._log(`AI 决策: ${JSON.stringify(action)}`);
      return action;
    } catch (err) {
      if (err.message.startsWith('API') || err.message.startsWith('解析') || err.message.startsWith('AI')) {
        throw err;
      }
      const msg = `API 请求异常: ${err.message}`;
      this.emit('error', new Error(msg));
      throw new Error(msg);
    }
  }

  /**
   * 核心运行循环
   * @param {string} userGoal - 用户的自然语言任务目标
   * @returns {Promise<void>}
   */
  async run(userGoal) {
    this.running = true;
    this.iteration = 0;
    const history = [];

    this.emit('start', { goal: userGoal });
    this._log(`开始执行任务: ${userGoal}`);

    try {
      while (this.running && this.iteration < this.maxIterations) {
        // a. 截图 -> base64
        let imageBase64;
        try {
          imageBase64 = await this.captureScreenBase64();
        } catch (err) {
          this.emit('error', err);
          this._log(`截图失败，等待 2 秒重试...`);
          await this._sleep(2000);
          this.iteration++;
          continue;
        }

        // b. emit 'screenshot' 事件
        this.emit('screenshot', { iteration: this.iteration, imageBase64 });

        // c. 调用 analyzeScreen 获取下一步动作
        let action;
        try {
          action = await this.analyzeScreen(imageBase64, userGoal, history);
        } catch (err) {
          this.emit('error', err);
          this._log(`分析屏幕失败，等待 2 秒重试...`);
          await this._sleep(2000);
          this.iteration++;
          continue;
        }

        // d. emit 'thinking' 事件
        this.emit('thinking', { iteration: this.iteration, action });

        // e. 如果 action.type === 'done'，任务完成
        if (action.type === 'done') {
          this._log(`任务完成: ${action.summary || ''}`);
          this.emit('done', { summary: action.summary || '任务完成' });
          break;
        }

        // f. 执行 action
        const result = await this.executeAction(action);

        // g. emit 'action' 事件
        this.emit('action', { iteration: this.iteration, action, result });

        // 记录到历史
        history.push({ action, result });

        // h. 等待 1 秒让界面响应
        await this._sleep(1000);

        // i. iteration++
        this.iteration++;
      }

      // 4. 如果循环结束仍未完成
      if (this.running && this.iteration >= this.maxIterations) {
        this._log(`达到最大迭代次数 (${this.maxIterations})，停止运行`);
        this.emit('max-iterations', { iterations: this.iteration });
      }
    } catch (err) {
      this.emit('error', err);
    } finally {
      this.running = false;
      this._log('Agent 已停止');
    }
  }

  /**
   * 停止运行
   */
  stop() {
    this._log('收到停止信号');
    this.running = false;
  }

  // ========== 内部辅助方法 ==========

  /**
   * 执行 adb 命令（Promise 封装）
   * @param {string[]} args
   * @returns {Promise<string>}
   * @private
   */
  _execAdb(args) {
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        ['-s', this.serial, ...args],
        { maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
            return;
          }
          resolve(stdout);
        }
      );
    });
  }

  /**
   * 延迟指定毫秒
   * @param {number} ms
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 输出日志
   * @param {string} message
   * @private
   */
  _log(message) {
    this.emit('log', { message: `${LOG_PREFIX} ${message}` });
  }
}

module.exports = { AgentEngine };
