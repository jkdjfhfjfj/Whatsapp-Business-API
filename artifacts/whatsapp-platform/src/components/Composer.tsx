import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, Mic, Square, X, Trash2, FileText, AudioLines, List, Plus } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../Toast';
import AttachMenu from './AttachMenu';

type PendingAttachment = { file: File | Blob; kind: 'image' | 'document' | 'video' | 'audio'; previewUrl?: string; name: string };
type ButtonDraft = { title: string; id: string; link?: string };
type RowDraft = { title: string; description: string; id: string };
type AdvancedDraft = {
  message: string;
  headerText: string;
  footerText: string;
  actionTitle: string;
  buttons: ButtonDraft[];
  rows: RowDraft[];
};

const emptyAdvancedDraft: AdvancedDraft = {
  message: '',
  headerText: '',
  footerText: '',
  actionTitle: 'View options',
  buttons: [{ title: '', id: '', link: '' }],
  rows: [{ title: '', description: '', id: '' }],
};

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
  const [advancedType, setAdvancedType] = useState<'buttons' | 'list' | null>(null);
  const [advanced, setAdvanced] = useState<AdvancedDraft>(emptyAdvancedDraft);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { api.listQuickReplies().then(setQuickReplies).catch(() => {}); }, []);
  useEffect(() => {
    // Reset the composer whenever the conversation changes so drafts don't leak between chats.
    setText(''); setAttachment(null); setShowAttachMenu(false); setAdvancedType(null); setAdvanced(emptyAdvancedDraft);
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

  function insertQuickReply(reply: any) {
    if (reply.messageType === 'buttons' || reply.messageType === 'list') {
      const payload = reply.payload ?? {};
      setText('');
      setAdvancedType(reply.messageType);
      setAdvanced({
        ...emptyAdvancedDraft,
        message: reply.message ?? '',
        headerText: payload.headerText ?? '',
        footerText: payload.footerText ?? '',
        actionTitle: payload.actionTitle ?? 'View options',
        buttons: Array.isArray(payload.buttons) && payload.buttons.length ? payload.buttons : emptyAdvancedDraft.buttons,
        rows: Array.isArray(payload.listOfSections?.[0]?.rows) && payload.listOfSections[0].rows.length
          ? payload.listOfSections[0].rows
          : emptyAdvancedDraft.rows,
      });
    } else {
      setAdvancedType(null);
      setText(reply.message ?? '');
    }
    setQuickReplyFilter(null);
    textareaRef.current?.focus();
  }

  async function send() {
    if (sending) return;
    if (attachment) return sendAttachment();
    if (advancedType) return sendAdvanced();
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

  async function sendAdvanced() {
    if (!advancedType || sending) return;
    if (!advanced.message.trim()) {
      toast(advancedType === 'buttons' ? 'Add the button message text.' : 'Add the list message text.', 'error');
      return;
    }
    setSending(true);
    try {
      if (advancedType === 'buttons') {
        const buttons = advanced.buttons.filter((button) => button.title.trim() && (button.id.trim() || button.link?.trim()));
        if (buttons.length < 1 || buttons.length > 3) {
          toast('Add between 1 and 3 complete buttons.', 'error');
          return;
        }
        await api.sendButtons(conversationId, advanced.message.trim(), buttons, advanced.headerText.trim() || undefined, advanced.footerText.trim() || undefined);
      } else {
        const rows = advanced.rows.filter((row) => row.title.trim() && row.description.trim() && row.id.trim());
        if (rows.length < 1 || rows.length > 10) {
          toast('Add between 1 and 10 complete list rows.', 'error');
          return;
        }
        await api.sendList(conversationId, {
          headerText: advanced.headerText.trim() || undefined,
          bodyText: advanced.message.trim(),
          footerText: advanced.footerText.trim() || undefined,
          actionTitle: advanced.actionTitle.trim() || 'View options',
          listOfSections: [{ title: 'Options', rows }],
        });
      }
      setAdvancedType(null);
      setAdvanced(emptyAdvancedDraft);
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

  const filteredQuickReplies = quickReplyFilter !== null
    ? quickReplies.filter((q) => q.shortcut.replace(/^\/+/, '').toLowerCase().startsWith(quickReplyFilter.toLowerCase()))
    : [];

  return (
    <div className="composer-wrap">
      {disabled && (
        <div className="composer-window-warning">
          {disabledReason ?? 'This chat is outside Meta’s 24-hour window. Quick replies and media are ready to submit, but Meta may require an approved template before delivery.'}
        </div>
      )}
      {attachment && (
        <div className="attachment-preview">
          {attachment.previewUrl && attachment.kind === 'image' && <img src={attachment.previewUrl} alt="" />}
          {attachment.previewUrl && attachment.kind === 'video' && <video src={attachment.previewUrl} controls />}
           {attachment.kind === 'document' && <span className="doc-chip"><FileText size={15} /> {attachment.name}</span>}
           {attachment.kind === 'audio' && <span className="doc-chip"><AudioLines size={15} /> Voice note ready to send</span>}
          <button className="icon-btn" onClick={() => setAttachment(null)} aria-label="Remove attachment"><X size={18} /></button>
        </div>
      )}

      {advancedType && (
        <div className="advanced-panel">
          <div className="advanced-panel-top">
            <strong>{advancedType === 'buttons' ? 'Button message' : 'List message'}</strong>
            <button className="icon-btn" onClick={() => { setAdvancedType(null); setAdvanced(emptyAdvancedDraft); }} aria-label="Close advanced message"><X size={16} /></button>
          </div>
          <label>Header (optional)
            <input value={advanced.headerText} maxLength={60} onChange={(e) => setAdvanced({ ...advanced, headerText: e.target.value })} placeholder="Header text" />
          </label>
          <label>{advancedType === 'buttons' ? 'Message' : 'Body'}
            <textarea rows={2} value={advanced.message} onChange={(e) => setAdvanced({ ...advanced, message: e.target.value })} placeholder="Message shown to the customer" />
          </label>
          {advancedType === 'buttons' ? (
            <div className="advanced-fields">
              {advanced.buttons.map((button, index) => (
                <div className="advanced-item-row" key={index}>
                  <input value={button.title} maxLength={20} onChange={(e) => setAdvanced({ ...advanced, buttons: advanced.buttons.map((b, i) => i === index ? { ...b, title: e.target.value } : b) })} placeholder={`Button ${index + 1} title`} />
                  <input value={button.id} maxLength={256} onChange={(e) => setAdvanced({ ...advanced, buttons: advanced.buttons.map((b, i) => i === index ? { ...b, id: e.target.value } : b) })} placeholder="Reply ID (or leave blank)" />
                  <input type="url" value={button.link ?? ''} maxLength={2048} onChange={(e) => setAdvanced({ ...advanced, buttons: advanced.buttons.map((b, i) => i === index ? { ...b, link: e.target.value } : b) })} placeholder="URL button link (optional)" />
                </div>
              ))}
              {advanced.buttons.length < 3 && <button type="button" className="secondary-action" onClick={() => setAdvanced({ ...advanced, buttons: [...advanced.buttons, { title: '', id: '', link: '' }] })}><Plus size={14} /> Add button</button>}
            </div>
          ) : (
            <div className="advanced-fields">
              <label>Rows
                {advanced.rows.map((row, index) => (
                  <div className="advanced-item-row list-row" key={index}>
                    <input value={row.title} maxLength={24} onChange={(e) => setAdvanced({ ...advanced, rows: advanced.rows.map((r, i) => i === index ? { ...r, title: e.target.value } : r) })} placeholder="Row title" />
                    <input value={row.description} maxLength={72} onChange={(e) => setAdvanced({ ...advanced, rows: advanced.rows.map((r, i) => i === index ? { ...r, description: e.target.value } : r) })} placeholder="Description" />
                    <input value={row.id} maxLength={200} onChange={(e) => setAdvanced({ ...advanced, rows: advanced.rows.map((r, i) => i === index ? { ...r, id: e.target.value } : r) })} placeholder="Row ID" />
                  </div>
                ))}
              </label>
              {advanced.rows.length < 10 && <button type="button" className="secondary-action" onClick={() => setAdvanced({ ...advanced, rows: [...advanced.rows, { title: '', description: '', id: '' }] })}><Plus size={14} /> Add row</button>}
            </div>
          )}
          <label>Footer (optional)
            <input value={advanced.footerText} maxLength={60} onChange={(e) => setAdvanced({ ...advanced, footerText: e.target.value })} placeholder="Footer text" />
          </label>
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
             <li key={q.id} onClick={() => insertQuickReply(q)}>
               <strong>{q.shortcut}</strong> <span>{q.messageType !== 'text' ? `[${q.messageType}] ` : ''}{q.message.slice(0, 60)}</span>
            </li>
          ))}
        </ul>
      )}

      {!recording && (
        <div className="composer">
          <button className="icon-btn" onClick={() => setShowAttachMenu(true)} aria-label="Attach"><Paperclip size={22} /></button>
          <button className={`icon-btn ${advancedType ? 'active' : ''}`} onClick={() => { setAdvancedType(advancedType ? null : 'buttons'); setAdvanced(advancedType ? emptyAdvancedDraft : advanced); }} aria-label="Advanced message"><List size={20} /></button>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={attachment ? 'Add a caption…' : 'Type a message  ·  / for quick replies'}
            rows={1}
          />

          {text.trim() || attachment || advancedType ? (
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
