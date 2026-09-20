import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Mic, Square, X, Trash2, FileText, AudioLines } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../Toast';
import AttachMenu from './AttachMenu';

type PendingAttachment = { file: File | Blob; kind: 'image' | 'document' | 'video' | 'audio'; previewUrl?: string; name: string };

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function Composer({ conversationId, disabled, disabledReason, onSent }: {
  conversationId: string; disabled?: boolean; disabledReason?: string; onSent?: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [quickReplies, setQuickReplies] = useState<any[]>([]);
  const [quickReplyFilter, setQuickReplyFilter] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { api.listQuickReplies().then(setQuickReplies).catch(() => {}); }, []);
  useEffect(() => {
    // Reset the composer whenever the conversation changes so drafts don't leak between chats.
    setText(''); setAttachment(null); setShowAttachMenu(false);
  }, [conversationId]);

  // Auto-grow the textarea up to a sane cap instead of a fixed single-line box.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  function handleTextChange(value: string) {
    setText(value);
    const match = value.match(/(^|\s)\/(\S*)$/);
    setQuickReplyFilter(match ? match[2] : null);
  }

  function insertQuickReply(message: string) {
    setText(message);
    setQuickReplyFilter(null);
    textareaRef.current?.focus();
  }

  async function send() {
    if (sending) return;
    if (attachment) return sendAttachment();
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.sendText(conversationId, text.trim());
      setText('');
      onSent?.();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSending(false);
    }
  }

  async function sendAttachment() {
    if (!attachment) return;
    setSending(true);
    try {
      const uploaded = await api.uploadFile(attachment.file, attachment.name);
      await api.sendMedia(attachment.kind, conversationId, uploaded.id, text.trim() || undefined);
      setAttachment(null);
      setText('');
      onSent?.();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSending(false);
    }
  }

  function onPickFile(file: File, kind: 'image' | 'document' | 'video' | 'audio') {
    const previewUrl = kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : undefined;
    setAttachment({ file, kind, previewUrl, name: file.name });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recordingType = ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, recordingType ? { mimeType: recordingType } : undefined);
      chunks.current = [];
      recorder.ondataavailable = (e) => chunks.current.push(e.data);
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || recordingType || 'audio/ogg';
        const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('webm') ? 'webm' : 'ogg';
        const blob = new Blob(chunks.current, { type: mimeType });
        setAttachment({ file: blob, kind: 'audio', name: `voice-note.${extension}` });
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      mediaRecorder.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      recordTimer.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      toast('Microphone access is required to record a voice note.', 'error');
    }
  }

  function stopRecording() {
    mediaRecorder.current?.stop();
    setRecording(false);
    if (recordTimer.current) clearInterval(recordTimer.current);
  }

  if (disabled) {
    return (
      <div className="composer composer-disabled">
        {disabledReason ?? '24-hour customer service window has expired — send an approved template to re-open the conversation.'}
      </div>
    );
  }

  const filteredQuickReplies = quickReplyFilter !== null
    ? quickReplies.filter((q) => q.shortcut.replace(/^\/+/, '').toLowerCase().startsWith(quickReplyFilter.toLowerCase()))
    : [];

  return (
    <div className="composer-wrap">
      {attachment && (
        <div className="attachment-preview">
          {attachment.previewUrl && attachment.kind === 'image' && <img src={attachment.previewUrl} alt="" />}
          {attachment.previewUrl && attachment.kind === 'video' && <video src={attachment.previewUrl} controls />}
           {attachment.kind === 'document' && <span className="doc-chip"><FileText size={15} /> {attachment.name}</span>}
           {attachment.kind === 'audio' && <span className="doc-chip"><AudioLines size={15} /> Voice note ready to send</span>}
          <button className="icon-btn" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X size={18} /></button>
        </div>
      )}

      {recording && (
        <div className="recording-bar">
          <span className="rec-dot" /> Recording… {formatDuration(recordSeconds)}
          <button className="icon-btn" onClick={stopRecording} aria-label="Cancel recording"><Trash2 size={16} /></button>
        </div>
      )}

      {filteredQuickReplies.length > 0 && (
        <ul className="quick-reply-menu">
          {filteredQuickReplies.map((q) => (
            <li key={q.id} onClick={() => insertQuickReply(q.message)}>
              <strong>{q.shortcut}</strong> <span>{q.message.slice(0, 60)}</span>
            </li>
          ))}
        </ul>
      )}

      {!recording && (
        <div className="composer">
          <button className="icon-btn" onClick={() => setShowAttachMenu(true)} aria-label="Attach"><Paperclip size={22} /></button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={attachment ? 'Add a caption…' : 'Type a message  ·  / for quick replies'}
            rows={1}
          />

          {text.trim() || attachment ? (
            <button className="send-btn" onClick={send} disabled={sending} aria-label="Send">
              {sending ? <span className="spinner" /> : <Send size={20} />}
            </button>
          ) : (
            <button className="icon-btn mic-btn" onClick={startRecording} aria-label="Record voice note"><Mic size={22} /></button>
          )}
        </div>
      )}

      {recording && (
        <div className="composer">
          <div style={{ flex: 1 }} />
          <button className="send-btn recording" onClick={stopRecording} aria-label="Stop and preview"><Square size={18} /></button>
        </div>
      )}

      {showAttachMenu && <AttachMenu onPick={onPickFile} onClose={() => setShowAttachMenu(false)} />}
    </div>
  );
}
