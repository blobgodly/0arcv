import React, { useState } from 'react';
import { Image as ImageIcon, File as FileIcon } from 'lucide-react';
import { ImagesView } from '../images/ImagesView';
import { AllFilesView } from './AllFilesView';

type FilesOption = 'images' | 'files';

export const FilesView: React.FC = () => {
  const [selectedOption, setSelectedOption] = useState<FilesOption>('images');

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      {/* Minimal 2-option switcher */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
        <div
          className="inline-flex items-center p-1 rounded-lg bg-white/[0.03] border border-white/[0.07]"
          role="tablist"
          aria-label="Files section"
        >
          <button
            type="button"
            role="tab"
            aria-selected={selectedOption === 'images'}
            onClick={() => setSelectedOption('images')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              selectedOption === 'images'
                ? 'bg-white text-black shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Images</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={selectedOption === 'files'}
            onClick={() => setSelectedOption('files')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              selectedOption === 'files'
                ? 'bg-white text-black shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <FileIcon className="w-3.5 h-3.5" />
            <span>Files</span>
          </button>
        </div>
      </div>

      {/* Active view */}
      {selectedOption === 'images' ? <ImagesView /> : <AllFilesView />}
    </div>
  );
};
