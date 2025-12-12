'use client';

interface PlaceholderWindowProps {
  title: string;
  message?: string;
}

export function PlaceholderWindow({ title, message }: PlaceholderWindowProps) {
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{ color: 'var(--theme-text-secondary)' }}
    >
      <div className="text-center">
        <h2 className="text-lg font-medium mb-2">{title}</h2>
        <p className="text-sm">{message || 'Coming soon...'}</p>
      </div>
    </div>
  );
}

export default PlaceholderWindow;
