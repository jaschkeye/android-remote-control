import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Square, Bot, User, Loader2, CheckCircle2, AlertCircle,
  Hand, Settings, Eye, Zap, Rocket, Clock, Keyboard, Navigation
} from 'lucide-react';
import type { AgentEvent, AgentConfig } from '../types';

interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  type?: 'text' | 'action' | 'screenshot' | 'error' | 'done' | 'thinking';
  detail?: string;
  imageBase64?: string;
  action?: Record<string, unknown>;
  iteration?: number;
}

interface AgentPanelProps {
  onRun: (goal: string, config: AgentConfig) => void;
  onStop: () => void;
  running: boolean;
}

const DEFAULT_CONFIG: AgentConfig = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
  maxIterations: 20,
};

const ACTION_LABELS: Record<string, string> = {
  tap: '点击',
  swipe: '滑动',
  text: '输入文字',
  keyevent: '按键',
  longpress: '长按',
  launch: '启动应用',
  wait: '等待',
  done: '完成',
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  tap: <Hand className="w-3 h-3" />,
  swipe: <Navigation className="w-3 h-3" />,
  text: <Keyboard className="w-3 h-3" />,
  keyevent: <Zap className="w-3 h-3" />,
  longpress: <Hand className="w-3 h-3" />,
  launch: <Rocket className="w-3 h-3" />,
  wait: <Clock className="w-3 h-3" />,
  done: <CheckCircle2 className="w-3 h-3" />,
};

const EXAMPLE_PROMPTS = [
  '打开微信',
  '打开设置查看WiFi密码',
  '打开相机拍一张照片',
  '打开抖音',
];

export default function AgentPanel({ onRun, onStop, running }: AgentPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [showScreenshot, setShowScreenshot] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: AgentEvent) => {
      switch (event.type) {
        case 'start':
          setMessages((m) => [...m, {
            id: `sys-${Date.now()}`,
            role: 'system',
            content: `开始执行: ${event.goal}`,
            type: 'text',
          }]);
          break;
        case 'screenshot':
          // Only show screenshot if enabled and we have a base64 image
          if (showScreenshot && event.imageBase64) {
            setMessages((m) => [...m, {
              id: `shot-${event.iteration}-${Date.now()}`,
              role: 'agent',
              content: `截图 #${(event.iteration ?? 0) + 1}`,
              type: 'screenshot',
              imageBase64: event.imageBase64,
              iteration: event.iteration,
            }]);
          }
          break;
        case 'thinking':
          setMessages((m) => [...m, {
            id: `think-${event.iteration}-${Date.now()}`,
            role: 'agent',
            content: formatAction(event.action),
            type: 'thinking',
            action: event.action,
            iteration: event.iteration,
          }]);
          break;
        case 'action':
          setMessages((m) => {
            const last = m[m.length - 1];
            if (last && last.type === 'thinking' && last.role === 'agent') {
              return [...m.slice(0, -1), {
                ...last,
                type: 'action',
                detail: event.result?.success ? '✓ 成功' : '✗ 失败',
                content: last.content + (event.result ? `\n${event.result.detail}` : ''),
              }];
            }
            return m;
          });
          break;
        case 'done':
          setMessages((m) => [...m, {
            id: `done-${Date.now()}`,
            role: 'system',
            content: `任务完成: ${event.summary}`,
            type: 'done',
          }]);
          break;
        case 'error':
          setMessages((m) => [...m, {
            id: `err-${Date.now()}`,
            role: 'system',
            content: event.message || '未知错误',
            type: 'error',
          }]);
          break;
        case 'max-iterations':
          setMessages((m) => [...m, {
            id: `max-${Date.now()}`,
            role: 'system',
            content: `达到最大迭代次数 (${event.iterations})`,
            type: 'error',
          }]);
          break;
        case 'log':
          break;
      }
    };
    const unsub = window.electronAPI.onAgentEvent(handler);
    return unsub;
  }, [showScreenshot]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || running) return;
    if (!config.apiKey) {
      setShowConfig(true);
      return;
    }
    setMessages((m) => [...m, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      type: 'text',
    }]);
    onRun(input.trim(), config);
    setInput('');
  }, [input, running, config, onRun]);

  const formatAction = (action?: Record<string, unknown>): string => {
    if (!action) return '';
    const label = ACTION_LABELS[action.type as string] || action.type as string;
    switch (action.type) {
      case 'tap': return `${label} (${action.x}, ${action.y})`;
      case 'swipe': return `${label} (${action.x1},${action.y1}) → (${action.x2},${action.y2})`;
      case 'text': return `${label} "${action.text}"`;
      case 'keyevent': return `${label} ${action.keycode}`;
      case 'longpress': return `${label} (${action.x}, ${action.y}) ${action.duration}ms`;
      case 'launch': return `${label} ${action.package}`;
      case 'wait': return `${label} ${action.duration}ms`;
      case 'done': return `${label}: ${action.summary}`;
      default: return JSON.stringify(action);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] flex-shrink-0">
        <Bot className="w-4 h-4 text-[var(--accent)]" />
        <span className="text-sm font-medium">AI 助手</span>
        {running && (
          <Loader2 className="w-3.5 h-3.5 text-[var(--accent)] animate-spin ml-1" />
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowScreenshot(!showScreenshot)}
          className={`p-1.5 rounded transition-colors ${showScreenshot ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
          title="切换截图显示"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-tertiary)] space-y-2 flex-shrink-0">
          <div>
            <label className="text-xs text-[var(--text-tertiary)] mb-1 block">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full px-2 py-1.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-[var(--text-tertiary)] mb-1 block">模型</label>
              <input
                value={config.model}
                onChange={(e) => setConfig({ ...config, model: e.target.value })}
                placeholder="gpt-4o"
                className="w-full px-2 py-1.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-tertiary)] mb-1 block">最大步数</label>
              <input
                type="number"
                value={config.maxIterations}
                onChange={(e) => setConfig({ ...config, maxIterations: Number(e.target.value) })}
                className="w-full px-2 py-1.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--text-tertiary)] mb-1 block">API Base URL</label>
            <input
              value={config.baseUrl}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="w-full px-2 py-1.5 bg-[var(--bg-primary)] border border-[var(--border)] rounded text-xs text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
            />
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            支持任何 OpenAI 兼容的 API。模型需支持视觉（如 gpt-4o, gpt-4-vision）。
          </p>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Bot className="w-10 h-10 text-[var(--text-tertiary)] mx-auto mb-2" strokeWidth={1} />
            <p className="text-[var(--text-secondary)] text-sm mb-1">告诉 AI 你想做什么</p>
            <p className="text-[var(--text-tertiary)] text-xs mb-4">AI 会自动操控你的手机完成任务</p>
            <div className="space-y-1.5">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => !running && setInput(prompt)}
                  className="block w-full text-left px-3 py-1.5 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] hover:bg-[var(--border)] rounded transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
              msg.role === 'user' ? 'bg-[var(--accent-dim)]' :
              msg.type === 'error' ? 'bg-red-900/40' :
              msg.type === 'done' ? 'bg-green-900/40' :
              msg.type === 'action' ? 'bg-[var(--accent-dim)]' :
              msg.type === 'screenshot' ? 'bg-[var(--bg-tertiary)]' :
              'bg-[var(--bg-tertiary)]'
            }`}>
              {msg.role === 'user' ? <User className="w-3.5 h-3.5 text-[var(--accent)]" /> :
               msg.type === 'error' ? <AlertCircle className="w-3.5 h-3.5 text-red-400" /> :
               msg.type === 'done' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> :
               msg.type === 'action' ? (ACTION_ICONS[(msg.action?.type as string)] || <Hand className="w-3.5 h-3.5 text-[var(--accent)]" />) :
               msg.type === 'screenshot' ? <Eye className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> :
               msg.type === 'thinking' ? <Loader2 className="w-3.5 h-3.5 text-[var(--accent)] animate-spin" /> :
               <Bot className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
            </div>
            <div className={`max-w-[85%] ${
              msg.type === 'screenshot' ? 'w-full max-w-[200px]' : ''
            }`}>
              {/* Screenshot display */}
              {msg.type === 'screenshot' && msg.imageBase64 && (
                <div className="relative rounded-lg overflow-hidden border border-[var(--border)]">
                  <img
                    src={`data:image/png;base64,${msg.imageBase64}`}
                    alt={`Screenshot ${msg.iteration}`}
                    className="w-full h-auto block"
                    style={{ maxHeight: '300px', objectFit: 'contain' }}
                  />
                  <span className="absolute top-1 left-1 text-[9px] mono text-white bg-black/60 px-1.5 py-0.5 rounded">
                    #{(msg.iteration ?? 0) + 1}
                  </span>
                </div>
              )}
              {/* Text content */}
              {msg.type !== 'screenshot' && (
                <div className={`px-3 py-2 rounded-lg text-sm ${
                  msg.role === 'user' ? 'bg-[var(--accent-dim)] text-[var(--bg-primary)]' :
                  msg.type === 'error' ? 'bg-red-950/40 text-red-300 border border-red-900/50' :
                  msg.type === 'done' ? 'bg-green-950/40 text-green-300 border border-green-900/50' :
                  msg.type === 'action' ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--accent)]/30' :
                  msg.type === 'thinking' ? 'bg-[var(--bg-tertiary)]/50 text-[var(--text-secondary)] border border-dashed border-[var(--border)]' :
                  'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                }`}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.detail && (
                    <p className="text-xs mt-1 opacity-70">{msg.detail}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="px-3 py-2.5 border-t border-[var(--border)] flex-shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
            placeholder={running ? 'AI 正在操作...' : '输入你的需求...'}
            disabled={running}
            className="flex-1 px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)] outline-none disabled:opacity-50"
          />
          {running ? (
            <button onClick={onStop}
              className="px-3 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-400 rounded-lg flex items-center gap-1.5 transition-colors flex-shrink-0">
              <Square className="w-3.5 h-3.5 fill-current" /> 停止
            </button>
          ) : (
            <button onClick={handleSubmit}
              disabled={!input.trim()}
              className="px-3 py-2 bg-[var(--accent-dim)] hover:bg-[var(--accent)] text-[var(--bg-primary)] rounded-lg flex items-center gap-1.5 transition-colors flex-shrink-0 disabled:opacity-40">
              <Send className="w-3.5 h-3.5" /> 执行
            </button>
          )}
        </div>
        {!config.apiKey && !showConfig && (
          <p className="text-[10px] text-[var(--danger)] mt-1.5 ml-1">
            需要配置 API Key 才能使用 AI 功能
          </p>
        )}
      </div>
    </div>
  );
}
