/**
 * AI Agent Engine
 * 
 * Core perception-decision-execution loop for Android automation.
 * Uses vision LLM (GPT-4o / compatible) to analyze screenshots and decide actions.
 * 
 * Flow: screenshot → LLM vision analysis → ADB action execution → repeat
 */

const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const LOG_PREFIX = '[AgentEngine]';

const SYSTEM_PROMPT = `你是一个专业的 Android 手机操控助手。用户会给你一个任务目标，你需要通过分析手机屏幕截图来决定下一步操作。

## 可执行的动作

返回一个 JSON 对象，包含 type 和对应参数：

### 点击
{"type":"tap","x":500,"y":800}
在指定坐标处点击。

### 滑动
{"type":"swipe","x1":500,"y1":1000,"x2":500,"y2":200,"duration":300}
从 (x1,y1) 滑动到 (x2,y2)，duration 单位为毫秒。向上滑动查看更多内容，向下滑动刷新。

### 输入文字
{"type":"text","text":"要输入的文字"}
在当前焦点输入框中输入文字。仅支持英文和数字，中文需要使用输入法。

### 按键
{"type":"keyevent","keycode":4}
常用按键码：3=HOME, 4=BACK, 5=呼叫, 24=音量+, 25=音量-, 26=电源, 27=相机, 66=回车, 84=搜索, 187=最近任务

### 长按
{"type":"longpress","x":500,"y":800,"duration":1000}
在指定坐标处长按指定时间。

### 启动应用
{"type":"launch","package":"com.tencent.mm"}
通过包名启动应用。常用包名：
- 微信: com.tencent.mm
- QQ: com.tencent.mobileqq
- 支付宝: com.eg.android.AlipayGphone
- 抖音: com.ss.android.ugc.aweme
- 设置: com.android.settings
- 浏览器: com.android.browser
- 电话: com.android.dialer
- 短信: com.android.mms
- 相机: com.android.camera

### 等待
{"type":"wait","duration":2000}
等待指定毫秒数，让界面加载完成。

### 任务完成
{"type":"done","summary":"任务完成的简要说明"}
当任务目标已经达成时返回。

## 规则

1. **只返回一个 JSON 对象**，不要包含 markdown 标记（不要用 \`\`\`json）、不要解释文字
2. 坐标基于截图的实际像素尺寸，会在每次消息中提供
3. 每次只执行一个动作，不要合并多个动作
4. 如果当前界面已经可以完成任务，直接执行；如果需要多步，逐步执行
5. 如果界面正在加载，使用 wait 动作等待
6. 如果找不到目标元素，尝试滑动或使用返回键
7. 优先使用 launch 动作启动应用，而不是从桌面查找图标
8. 对于需要输入文字的场景，先点击输入框获取焦点，再输入文字`;

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
    this.screenSize = null; // {width, height} cached from device
  }

  /**
   * Capture screenshot, return PNG Buffer
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
            reject(new Error(`截图失败: ${error.message}`));
            return;
          }
          if (!stdout || stdout.length === 0) {
            reject(new Error('截图失败: 返回数据为空'));
            return;
          }
          this._log(`截图成功, 大小: ${stdout.length} bytes`);
          resolve(stdout);
        }
      );
    });
  }

  /**
   * Capture screenshot and convert to base64
   * @returns {Promise<string>}
   */
  async captureScreenBase64() {
    const buffer = await this.captureScreen();
    return buffer.toString('base64');
  }

  /**
   * Get device screen size via adb shell wm size
   * @returns {Promise<{width: number, height: number}>}
   */
  getScreenSize() {
    return new Promise((resolve, reject) => {
      execFile(
        this.adbPath,
        ['-s', this.serial, 'shell', 'wm', 'size'],
        { maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            reject(new Error(`获取屏幕尺寸失败: ${error.message}`));
            return;
          }
          const match = stdout.match(/(\d+)x(\d+)/);
          if (!match) {
            reject(new Error(`解析屏幕尺寸失败: ${stdout.trim()}`));
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
   * Execute a structured action
   * @param {object} action - Action object with type and parameters
   * @returns {Promise<{success: boolean, detail: string}>}
   */
  async executeAction(action) {
    if (!action || !action.type) {
      return { success: false, detail: '无效的动作: 缺少 type 字段' };
    }

    this._log(`执行动作: ${JSON.stringify(action)}`);

    try {
      switch (action.type) {
        case 'tap':
          await this._execAdb(['shell', 'input', 'tap', String(Math.round(action.x)), String(Math.round(action.y))]);
          return { success: true, detail: `点击 (${Math.round(action.x)}, ${Math.round(action.y)})` };

        case 'swipe':
          await this._execAdb([
            'shell', 'input', 'swipe',
            String(Math.round(action.x1)), String(Math.round(action.y1)),
            String(Math.round(action.x2)), String(Math.round(action.y2)),
            String(action.duration || 300)
          ]);
          return { success: true, detail: `滑动 (${Math.round(action.x1)},${Math.round(action.y1)}) → (${Math.round(action.x2)},${Math.round(action.y2)})` };

        case 'text':
          await this._execAdb(['shell', 'input', 'text', String(action.text)]);
          return { success: true, detail: `输入文字: ${action.text}` };

        case 'keyevent':
          await this._execAdb(['shell', 'input', 'keyevent', String(action.keycode)]);
          return { success: true, detail: `按键: ${action.keycode}` };

        case 'longpress':
          await this._execAdb([
            'shell', 'input', 'swipe',
            String(Math.round(action.x)), String(Math.round(action.y)),
            String(Math.round(action.x)), String(Math.round(action.y)),
            String(action.duration || 1000)
          ]);
          return { success: true, detail: `长按 (${Math.round(action.x)}, ${Math.round(action.y)}) ${action.duration || 1000}ms` };

        case 'launch':
          await this._execAdb(['shell', 'monkey', '-p', String(action.package), '-c', 'android.intent.category.LAUNCHER', '1']);
          return { success: true, detail: `启动应用: ${action.package}` };

        case 'wait':
          await this._sleep(action.duration || 2000);
          return { success: true, detail: `等待 ${action.duration || 2000}ms` };

        case 'done':
          return { success: true, detail: action.summary || '任务完成' };

        default:
          return { success: false, detail: `未知动作类型: ${action.type}` };
      }
    } catch (err) {
      return { success: false, detail: err.message };
    }
  }

  /**
   * Call vision LLM API to analyze current screen and decide next action
   * @param {string} imageBase64 - Base64 encoded PNG screenshot
   * @param {string} userGoal - User's natural language task goal
   * @param {Array} history - Previous action history
   * @returns {Promise<object>} - Next action to execute
   */
  async analyzeScreen(imageBase64, userGoal, history) {
    this._log('正在分析屏幕...');

    const sizeInfo = this.screenSize
      ? `当前屏幕分辨率: ${this.screenSize.width}x${this.screenSize.height}`
      : '屏幕分辨率未知';

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];

    // Add conversation history
    if (history && history.length > 0) {
      for (const entry of history) {
        messages.push({
          role: 'assistant',
          content: JSON.stringify(entry.action)
        });
        messages.push({
          role: 'user',
          content: `上一步执行${entry.result && entry.result.success ? '成功' : '失败'}: ${entry.result ? entry.result.detail : ''}\n\n${sizeInfo}\n这是当前手机屏幕截图，请分析并返回下一步操作。`
        });
      }
    } else {
      messages.push({
        role: 'user',
        content: `任务目标: ${userGoal}\n\n${sizeInfo}\n这是当前手机屏幕截图，请分析并返回下一步操作。`
      });
    }

    // Always include the current screenshot
    const lastMsg = messages[messages.length - 1];
    lastMsg.content = [
      { type: 'text', text: lastMsg.content },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
    ];

    const requestBody = {
      model: this.model,
      messages,
      max_tokens: 500,
      temperature: 0.1,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API 调用失败 (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.choices || data.choices.length === 0) {
      throw new Error('API 返回结果为空: 没有 choices');
    }

    const content = data.choices[0].message.content;
    // Strip markdown code blocks if present
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let action;
    try {
      action = JSON.parse(cleaned);
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          action = JSON.parse(jsonMatch[0]);
        } catch {
          throw new Error(`解析 AI 返回的动作失败: 原始内容: ${content.substring(0, 200)}`);
        }
      } else {
        throw new Error(`解析 AI 返回的动作失败: 原始内容: ${content.substring(0, 200)}`);
      }
    }

    if (!action.type) {
      throw new Error(`AI 返回的动作缺少 type 字段: ${JSON.stringify(action)}`);
    }

    this._log(`AI 决策: ${JSON.stringify(action)}`);
    return action;
  }

  /**
   * Core run loop: screenshot → analyze → execute → repeat
   * @param {string} userGoal - User's natural language task goal
   * @returns {Promise<void>}
   */
  async run(userGoal) {
    this.running = true;
    this.iteration = 0;
    const history = [];

    this.emit('start', { goal: userGoal });
    this._log(`开始执行任务: ${userGoal}`);

    // Get screen size at start
    try {
      this.screenSize = await this.getScreenSize();
    } catch (err) {
      this._log(`获取屏幕尺寸失败，将继续执行: ${err.message}`);
    }

    try {
      while (this.running && this.iteration < this.maxIterations) {
        // Step 1: Capture screenshot
        let imageBase64;
        try {
          imageBase64 = await this.captureScreenBase64();
        } catch (err) {
          this.emit('error', { message: err.message });
          this._log(`截图失败，等待 2 秒重试...`);
          await this._sleep(2000);
          this.iteration++;
          continue;
        }

        // Step 2: Emit screenshot event
        this.emit('screenshot', { iteration: this.iteration, imageBase64 });

        // Step 3: Analyze screen with LLM
        let action;
        try {
          action = await this.analyzeScreen(imageBase64, userGoal, history);
        } catch (err) {
          this.emit('error', { message: err.message });
          this._log(`分析屏幕失败，等待 2 秒重试...`);
          await this._sleep(2000);
          this.iteration++;
          continue;
        }

        // Step 4: Emit thinking event
        this.emit('thinking', { iteration: this.iteration, action });

        // Step 5: Check if task is done
        if (action.type === 'done') {
          this._log(`任务完成: ${action.summary || ''}`);
          this.emit('done', { summary: action.summary || '任务完成' });
          break;
        }

        // Step 6: Execute action
        const result = await this.executeAction(action);

        // Step 7: Emit action event
        this.emit('action', { iteration: this.iteration, action, result });

        // Step 8: Record in history
        history.push({ action, result });

        // Step 9: Wait for UI to respond
        await this._sleep(1500);

        this.iteration++;
      }

      if (this.running && this.iteration >= this.maxIterations) {
        this._log(`达到最大迭代次数 (${this.maxIterations})，停止运行`);
        this.emit('max-iterations', { iterations: this.iteration });
      }
    } catch (err) {
      this.emit('error', { message: err.message });
    } finally {
      this.running = false;
      this._log('Agent 已停止');
    }
  }

  /**
   * Stop the agent
   */
  stop() {
    this._log('收到停止信号');
    this.running = false;
  }

  // ========== Private helpers ==========

  /**
   * Execute adb command (Promise wrapper)
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
   * Sleep for specified milliseconds
   * @param {number} ms
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Log a message
   * @param {string} message
   * @private
   */
  _log(message) {
    this.emit('log', { message: `${LOG_PREFIX} ${message}` });
  }
}

module.exports = { AgentEngine };
