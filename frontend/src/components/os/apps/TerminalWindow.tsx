'use client';

import { useState, useRef, useEffect } from 'react';
import { Terminal, Play, RefreshCw, Trash2, Copy, Check, ChevronDown } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_PREFIX = '';

type Language = 'python' | 'javascript' | 'shell';

interface ExecutionResult {
  id?: string;
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  language: string;
}

const languageConfig: Record<Language, { label: string; extension: string; placeholder: string }> = {
  python: {
    label: 'Python',
    extension: 'py',
    placeholder: '# Write your Python code here\nprint("Hello, World!")',
  },
  javascript: {
    label: 'JavaScript',
    extension: 'js',
    placeholder: '// Write your JavaScript code here\nconsole.log("Hello, World!");',
  },
  shell: {
    label: 'Shell',
    extension: 'sh',
    placeholder: '# Write your shell commands here\necho "Hello, World!"',
  },
};

export default function TerminalWindow() {
  const [code, setCode] = useState(languageConfig.python.placeholder);
  const [language, setLanguage] = useState<Language>('python');
  const [output, setOutput] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<Array<{ code: string; language: Language; output: string; success: boolean }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    // Scroll output to bottom when new output arrives
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, error]);

  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang);
    setCode(languageConfig[newLang].placeholder);
    setOutput('');
    setError('');
    setExecutionTime(null);
  };

  const handleExecute = async () => {
    if (!code.trim() || running) return;

    setRunning(true);
    setOutput('');
    setError('');
    setExecutionTime(null);

    try {
      const response = await fetch(`${API_URL}${API_PREFIX}/api/abilities/code/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code, language }),
      });

      const result: ExecutionResult = await response.json();

      if (result.success) {
        setOutput(result.output || '(no output)');
      } else {
        setError(result.error || 'Execution failed');
        if (result.output) setOutput(result.output);
      }
      setExecutionTime(result.executionTimeMs);

      // Add to history
      setHistory(prev => [
        { code, language, output: result.output || result.error || '', success: result.success },
        ...prev.slice(0, 9), // Keep last 10
      ]);
    } catch (err) {
      setError(`Failed to execute: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  const handleClear = () => {
    setCode(languageConfig[language].placeholder);
    setOutput('');
    setError('');
    setExecutionTime(null);
  };

  const handleCopyOutput = async () => {
    const text = error || output;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + Enter to run
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    }
    // Tab to insert spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newCode = code.substring(0, start) + '  ' + code.substring(end);
        setCode(newCode);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }, 0);
      }
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--theme-bg-primary)' }}>
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
      >
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5" style={{ color: 'var(--theme-accent-primary)' }} />
          <div className="relative">
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value as Language)}
              className="appearance-none text-sm py-1.5 pl-3 pr-8 rounded focus:outline-none cursor-pointer"
              style={{
                background: 'var(--theme-bg-tertiary)',
                color: 'var(--theme-text-primary)',
                border: '1px solid var(--theme-border-default)',
              }}
            >
              {Object.entries(languageConfig).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--theme-text-muted)' }} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="p-1.5 rounded transition hover:bg-[var(--theme-bg-tertiary)]"
            style={{ color: 'var(--theme-text-muted)' }}
            title="Clear"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={handleExecute}
            disabled={running || !code.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded disabled:opacity-50 transition"
            style={{ background: 'var(--theme-accent-primary)', color: 'white' }}
            title="Run (Cmd+Enter)"
          >
            {running ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Run
          </button>
        </div>
      </div>

      {/* Split View */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Code Editor */}
        <div className="flex-1 flex flex-col border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--theme-border-default)' }}>
          <div className="px-3 py-1.5 text-xs border-b" style={{ borderColor: 'var(--theme-border-default)', color: 'var(--theme-text-muted)' }}>
            Code - {languageConfig[language].label}
          </div>
          <textarea
            ref={textareaRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 p-3 text-sm font-mono resize-none focus:outline-none"
            style={{
              background: 'var(--theme-bg-tertiary)',
              color: 'var(--theme-text-primary)',
              border: 'none',
            }}
            spellCheck={false}
            placeholder={languageConfig[language].placeholder}
          />
        </div>

        {/* Output Panel */}
        <div className="flex-1 flex flex-col min-h-[200px]">
          <div
            className="flex items-center justify-between px-3 py-1.5 border-b"
            style={{ borderColor: 'var(--theme-border-default)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Output</span>
              {executionTime !== null && (
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--theme-bg-tertiary)', color: 'var(--theme-text-muted)' }}>
                  {executionTime}ms
                </span>
              )}
            </div>
            {(output || error) && (
              <button
                onClick={handleCopyOutput}
                className="p-1 rounded transition hover:bg-[var(--theme-bg-tertiary)]"
                style={{ color: 'var(--theme-text-muted)' }}
                title="Copy output"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
          </div>
          <pre
            ref={outputRef}
            className="flex-1 p-3 text-sm font-mono overflow-auto whitespace-pre-wrap"
            style={{
              background: 'var(--theme-bg-primary)',
              color: error ? '#ff6b6b' : 'var(--theme-text-primary)',
            }}
          >
            {running ? (
              <span style={{ color: 'var(--theme-text-muted)' }}>Running...</span>
            ) : error ? (
              error
            ) : output ? (
              output
            ) : (
              <span style={{ color: 'var(--theme-text-muted)' }}>Output will appear here</span>
            )}
          </pre>
        </div>
      </div>

      {/* History Bar */}
      {history.length > 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2 border-t overflow-x-auto"
          style={{ borderColor: 'var(--theme-border-default)', background: 'var(--theme-bg-secondary)' }}
        >
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--theme-text-muted)' }}>History:</span>
          {history.map((item, idx) => (
            <button
              key={idx}
              onClick={() => {
                setLanguage(item.language);
                setCode(item.code);
                setOutput(item.output);
                setError(item.success ? '' : item.output);
              }}
              className="px-2 py-1 text-xs rounded flex-shrink-0 transition hover:opacity-80"
              style={{
                background: item.success ? 'rgba(0, 255, 159, 0.1)' : 'rgba(255, 107, 107, 0.1)',
                color: item.success ? '#00ff9f' : '#ff6b6b',
                border: `1px solid ${item.success ? 'rgba(0, 255, 159, 0.3)' : 'rgba(255, 107, 107, 0.3)'}`,
              }}
              title={item.code.slice(0, 50)}
            >
              {languageConfig[item.language].label} #{history.length - idx}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
