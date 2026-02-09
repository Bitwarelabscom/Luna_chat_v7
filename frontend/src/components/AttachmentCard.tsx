import { FileText, FileCode, Image as ImageIcon } from 'lucide-react';
import type { MessageAttachment } from '@/lib/api';

interface AttachmentCardProps {
  attachment: MessageAttachment;
}

export function AttachmentCard({ attachment }: AttachmentCardProps) {
  // Determine icon based on MIME type
  const getIcon = () => {
    if (attachment.mimeType.startsWith('image/')) {
      return <ImageIcon className="w-4 h-4 text-blue-400" />;
    }
    if (attachment.mimeType.includes('pdf') || attachment.mimeType.includes('document')) {
      return <FileText className="w-4 h-4 text-red-400" />;
    }
    return <FileCode className="w-4 h-4 text-green-400" />;
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Get status badge color
  const getStatusColor = () => {
    switch (attachment.status) {
      case 'ready':
        return 'bg-green-500/20 text-green-300';
      case 'processing':
        return 'bg-yellow-500/20 text-yellow-300';
      case 'error':
        return 'bg-red-500/20 text-red-300';
      default:
        return 'bg-gray-500/20 text-gray-300';
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg bg-gray-800/50 border border-gray-700/50 max-w-sm">
      <div className="flex items-center gap-2">
        {getIcon()}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-200 truncate">
            {attachment.originalName}
          </div>
          <div className="text-xs text-gray-400">
            {formatSize(attachment.fileSize)}
          </div>
        </div>
        <div className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor()}`}>
          {attachment.status}
        </div>
      </div>

      {attachment.analysisPreview && attachment.status === 'ready' && (
        <div className="text-xs text-gray-400 bg-gray-900/50 p-2 rounded border border-gray-700/30">
          <div className="font-medium text-gray-300 mb-1">Analysis:</div>
          <div className="line-clamp-3">{attachment.analysisPreview}</div>
        </div>
      )}
    </div>
  );
}
