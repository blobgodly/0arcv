import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useArchive } from '../../context/ArchiveContext';
import { getApiUrl } from '../../utils/apiConfig';
import {
  Upload,
  Search,
  Download,
  Trash2,
  X,
  File as FileIcon,
  FileText,
  FileCode,
  FileArchive,
  FileAudio,
  FileVideo,
  FileImage,
} from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';
import { formatSize } from '../images/ImagesView';

export type VaultFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  blob: Blob;
  url: string;
};

type StoredFile = Omit<VaultFile, 'url'>;

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const createId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const dataUrlToBlob = (dataUrl: string, fallbackType?: string) => {
  const [header, body] = dataUrl.split(',', 2);
  const bytes = Uint8Array.from(atob(body || ''), (char) => char.charCodeAt(0));
  const mime = header.match(/data:(.*?);/)?.[1] || fallbackType || 'application/octet-stream';
  return new Blob([bytes], { type: mime });
};

const readCloudFiles = async (): Promise<StoredFile[]> => {
  const response = await fetch(getApiUrl('/api/cloud/files'));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'File storage unavailable');
  }
  const payload = await response.json();
  if (!payload.ok || !Array.isArray(payload.files)) {
    throw new Error('File storage unavailable');
  }
  return payload.files.map((file: any) => ({
    id: String(file.id),
    name: String(file.name),
    type: String(file.type || 'application/octet-stream'),
    size: Number(file.size || 0),
    createdAt: Number(file.createdAt || Date.now()),
    blob: dataUrlToBlob(String(file.dataUrl), String(file.type || '')),
  }));
};

const writeCloudFiles = async (files: StoredFile[]) => {
  const serialized = await Promise.all(
    files.map(async (file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      size: file.size,
      createdAt: file.createdAt,
      dataUrl: await blobToDataUrl(file.blob),
    }))
  );
  const response = await fetch(getApiUrl('/api/cloud/files'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: serialized }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to save files');
  }
};

const removeCloudFile = async (id: string) => {
  const response = await fetch(getApiUrl(`/api/cloud/files/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Failed to delete file');
  }
};

const getExtension = (name: string): string => {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
};

const getFileIcon = (file: Pick<VaultFile, 'name' | 'type'>) => {
  const ext = getExtension(file.name);
  const type = (file.type || '').toLowerCase();

  if (type.startsWith('image/')) return <FileImage className="w-4 h-4 text-zinc-400" />;
  if (type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
    return <FileAudio className="w-4 h-4 text-zinc-400" />;
  }
  if (type.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) {
    return <FileVideo className="w-4 h-4 text-zinc-400" />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || type.includes('zip')) {
    return <FileArchive className="w-4 h-4 text-zinc-400" />;
  }
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'go', 'rs', 'sql', 'sh', 'yaml', 'yml'].includes(ext)) {
    return <FileCode className="w-4 h-4 text-zinc-400" />;
  }
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'xls', 'xlsx'].includes(ext) || type.includes('pdf') || type.startsWith('text/')) {
    return <FileText className="w-4 h-4 text-zinc-400" />;
  }
  return <FileIcon className="w-4 h-4 text-zinc-400" />;
};

const canPreviewInline = (file: Pick<VaultFile, 'name' | 'type'>) => {
  const ext = getExtension(file.name);
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/')) return true;
  if (type === 'application/pdf' || ext === 'pdf') return true;
  if (
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    ['txt', 'md', 'json', 'csv', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'py', 'sh', 'yaml', 'yml', 'sql', 'log'].includes(ext)
  ) {
    return true;
  }
  return false;
};

export const AllFilesView: React.FC = () => {
  const { settings, addToast } = useArchive();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<VaultFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<VaultFile | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<VaultFile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const refreshFiles = async () => {
    try {
      const stored = await readCloudFiles();
      setFiles((current) => {
        current.forEach((item) => URL.revokeObjectURL(item.url));
        return stored.map((item) => ({ ...item, url: URL.createObjectURL(item.blob) }));
      });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File storage unavailable.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshFiles();
    return () => {
      files.forEach((item) => URL.revokeObjectURL(item.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedFile) setSelectedFile(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFile]);

  useEffect(() => {
    let cancelled = false;
    setPreviewText(null);
    if (!selectedFile) return;

    const ext = getExtension(selectedFile.name);
    const type = (selectedFile.type || '').toLowerCase();
    const isTextLike =
      type.startsWith('text/') ||
      type.includes('json') ||
      type.includes('xml') ||
      ['txt', 'md', 'json', 'csv', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'py', 'sh', 'yaml', 'yml', 'sql', 'log'].includes(ext);

    if (isTextLike) {
      selectedFile.blob
        .text()
        .then((text) => {
          if (!cancelled) setPreviewText(text.slice(0, 100_000));
        })
        .catch(() => {
          if (!cancelled) setPreviewText(null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  const uploadFiles = async (fileList: File[]) => {
    if (!fileList.length) return;

    const oversized = fileList.filter((file) => file.size > MAX_FILE_BYTES);
    if (oversized.length) {
      const msg = `${oversized.length} file${oversized.length === 1 ? '' : 's'} exceed the 10 MB limit.`;
      setError(msg);
      addToast('Upload Limit', 'error', msg);
      return;
    }

    setError('');
    setIsUploading(true);
    try {
      const prepared: StoredFile[] = fileList.map((file) => ({
        id: createId(),
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        createdAt: Date.now(),
        blob: file,
      }));

      await writeCloudFiles(prepared);
      await refreshFiles();

      addToast(
        prepared.length === 1 ? 'File Saved' : `${prepared.length} Files Saved`,
        'success',
        prepared.length === 1 ? prepared[0].name : undefined
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save files.';
      setError(msg);
      addToast('Upload Failed', 'error', msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await uploadFiles(Array.from(event.target.files || []));
    event.target.value = '';
  };

  const handleDeleteFile = async (file: VaultFile) => {
    if (settings.confirmBeforeDelete) {
      setFileToDelete(file);
    } else {
      await executeDelete(file);
    }
  };

  const executeDelete = async (file: VaultFile) => {
    try {
      await removeCloudFile(file.id);
      if (selectedFile?.id === file.id) setSelectedFile(null);
      await refreshFiles();
      addToast('File Removed', 'info', file.name);
    } catch {
      addToast('Delete Failed', 'error', 'Could not delete file.');
    }
  };

  const handleDownload = (file: VaultFile, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files
      .filter((file) => !q || file.name.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [files, searchQuery]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setIsDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          await uploadFiles(Array.from(e.dataTransfer.files));
        }
      }}
      className="space-y-4 relative"
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleFileInput}
        className="sr-only"
        aria-hidden="true"
      />

      {isDragging && (
        <div className="absolute inset-0 z-30 rounded-xl bg-black/80 backdrop-blur-sm border-2 border-dashed border-white/40 flex flex-col items-center justify-center p-8 pointer-events-none">
          <Upload className="w-8 h-8 text-white mb-2" />
          <p className="text-xs font-medium text-white">Drop files to save</p>
        </div>
      )}

      {/* Single toolbar row */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/[0.2]"
          />
        </div>

        <button
          type="button"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 disabled:opacity-50 text-black text-xs font-medium transition-colors shrink-0"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>{isUploading ? 'Saving...' : 'Upload'}</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="surface-card rounded-xl p-10 text-center text-xs text-zinc-500">
          Loading...
        </div>
      )}

      {!isLoading && filteredFiles.length === 0 && (
        <div className="surface-card rounded-xl p-10 text-center space-y-3">
          <FileIcon className="w-7 h-7 text-zinc-600 mx-auto" />
          <p className="text-xs text-zinc-400">
            {files.length === 0 ? 'Drop or upload any file to save it here.' : 'No matching files.'}
          </p>
          {files.length === 0 && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black hover:bg-zinc-200 text-xs font-medium transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Choose Files</span>
            </button>
          )}
        </div>
      )}

      {/* Clean minimal list */}
      {!isLoading && filteredFiles.length > 0 && (
        <div className="surface-card rounded-xl divide-y divide-white/[0.06] overflow-hidden">
          {filteredFiles.map((file) => {
            const previewable = canPreviewInline(file);
            return (
              <div
                key={file.id}
                onClick={() => (previewable ? setSelectedFile(file) : handleDownload(file))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (previewable) setSelectedFile(file);
                    else handleDownload(file);
                  }
                }}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-white/[0.03] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {getFileIcon(file)}
                  <span className="truncate text-xs text-zinc-200" title={file.name}>
                    {file.name}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono text-zinc-500">
                    {formatSize(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleDownload(file, e)}
                    title={`Download ${file.name}`}
                    className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteFile(file);
                    }}
                    title={`Delete ${file.name}`}
                    className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Simple Preview Modal */}
      {selectedFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedFile(null)}
        >
          <div
            className="relative flex flex-col max-h-[90vh] max-w-4xl w-full surface-elevated rounded-2xl border border-white/[0.12] overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-[#0c0c0e]">
              <span className="text-xs font-medium text-white truncate pr-4">
                {selectedFile.name}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDownload(selectedFile)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-black/60 flex items-center justify-center p-4 overflow-auto min-h-[260px] max-h-[75vh]">
              {selectedFile.type.startsWith('image/') ? (
                <img
                  src={selectedFile.url}
                  alt={selectedFile.name}
                  className="max-h-full max-w-full object-contain rounded-lg"
                />
              ) : selectedFile.type.startsWith('video/') ? (
                <video src={selectedFile.url} controls className="max-h-[68vh] max-w-full rounded-lg" />
              ) : selectedFile.type.startsWith('audio/') ? (
                <audio src={selectedFile.url} controls className="w-full max-w-md" />
              ) : selectedFile.type === 'application/pdf' || getExtension(selectedFile.name) === 'pdf' ? (
                <iframe src={selectedFile.url} title={selectedFile.name} className="w-full h-[68vh] rounded-lg bg-white" />
              ) : previewText !== null ? (
                <pre className="w-full max-h-[68vh] overflow-auto text-xs font-mono text-zinc-200 bg-[#0c0c0e] p-4 rounded-lg border border-white/[0.06] whitespace-pre-wrap break-words">
                  {previewText}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(fileToDelete)}
        title="Delete file?"
        description={`Permanently delete "${fileToDelete?.name}"?`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (fileToDelete) {
            void executeDelete(fileToDelete);
            setFileToDelete(null);
          }
        }}
        onCancel={() => setFileToDelete(null)}
      />
    </div>
  );
};
