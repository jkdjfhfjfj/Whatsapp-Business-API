import { useRef } from 'react';
import { Image, FileText, Video, Camera, AudioLines } from 'lucide-react';

export default function AttachMenu({ onPick, onClose }: {
  onPick: (file: File, kind: 'image' | 'document' | 'video' | 'audio') => void;
  onClose: () => void;
}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  function handle(kind: 'image' | 'document' | 'video' | 'audio') {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onPick(file, kind);
      e.target.value = '';
      onClose();
    };
  }

  return (
    <div className="attach-menu-backdrop" onClick={onClose}>
      <div className="attach-menu" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => imageInput.current?.click()}>
          <span className="attach-icon photo"><Image size={20} /></span> Photos
        </button>
        <button onClick={() => videoInput.current?.click()}>
          <span className="attach-icon video"><Video size={20} /></span> Video
        </button>
        <button onClick={() => docInput.current?.click()}>
          <span className="attach-icon document"><FileText size={20} /></span> Document
        </button>
        <button onClick={() => audioInput.current?.click()}>
          <span className="attach-icon audio"><AudioLines size={20} /></span> Audio
        </button>
        <button onClick={() => cameraInput.current?.click()}>
          <span className="attach-icon camera"><Camera size={20} /></span> Camera
        </button>
      </div>
      <input ref={imageInput} type="file" accept="image/*" hidden onChange={handle('image')} />
      <input ref={videoInput} type="file" accept="video/*" hidden onChange={handle('video')} />
      <input ref={docInput} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt" hidden onChange={handle('document')} />
      <input ref={audioInput} type="file" accept="audio/*" hidden onChange={handle('audio')} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={handle('image')} />
    </div>
  );
}
