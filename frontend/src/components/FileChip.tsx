import { X } from 'lucide-react';

interface FileChipProps {
  file: File;
  onRemove: () => void;
}

export function FileChip({ file, onRemove }: FileChipProps) {
  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Truncate filename if too long
  const truncateName = (name: string, maxLength: number = 20): string => {
    if (name.length <= maxLength) return name;
    const extension = name.split('.').pop() || '';
    const nameWithoutExt = name.slice(0, name.lastIndexOf('.'));
    const truncated = nameWithoutExt.slice(0, maxLength - extension.length - 4);
    return `${truncated}...${extension}`;
  };

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-200 text-sm">
      <span className="font-medium">{truncateName(file.name)}</span>
      <span className="text-xs text-blue-300/70">({formatSize(file.size)})</span>
      <button
        onClick={onRemove}
        className="ml-1 hover:bg-blue-500/30 rounded-full p-0.5 transition-colors"
        aria-label="Remove file"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
