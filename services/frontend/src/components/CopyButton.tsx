import { useState } from 'react';

export default function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center space-x-1 text-xs text-gray-400 hover:text-indigo-600 transition-colors group"
      title={`Copy: ${text}`}
    >
      <code className="bg-gray-100 group-hover:bg-indigo-50 px-1.5 py-0.5 rounded text-[11px] font-mono">
        {label || `${text.substring(0, 8)}...${text.substring(text.length - 4)}`}
      </code>
      <span className="text-[10px]">{copied ? '✓' : '⧉'}</span>
    </button>
  );
}
