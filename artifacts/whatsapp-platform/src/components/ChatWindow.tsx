import { useEffect, useRef } from 'react';
import { Check, CheckCheck, Clock, AlertTriangle, ArrowLeft, MapPin, PanelRight } from 'lucide-react';
import Avatar from './Avatar';
import MediaBubble from './MediaBubble';

function renderContent(msg: any) {
  // Older webhook rows may contain the wrapper's public message names. Keep rendering
  // those rows after the server normalizes new inbound messages for storage.
  const type = msg.type === 'text_message' || msg.type === 'ad_message'
    ? 'text'
    : msg.type === 'media_message'
      ? ['image', 'video', 'audio', 'document'].find((kind) => msg.content?.[kind]) ?? 'unknown'
      : msg.type === 'audio_message'
        ? 'audio'
        : msg.type === 'sticker_message'
          ? 'image'
          : msg.type === 'location_message'
            ? 'location'
            : msg.type === 'contact_message'
              ? 'contact'
              : msg.type === 'quick_reply_message'
                ? 'button'
                : msg.type;

  switch (type) {
    case 'text':
      return <p>{msg.content.text ?? msg.content.body?.text ?? ''}</p>;
    case 'button': // inbound: customer tapped one of our buttons
    case 'list': // inbound: customer picked a list option
      return <p className="reply-echo">↳ {msg.content.title ?? msg.content.id}</p>;
    case 'interactive_buttons': // outbound: we sent a button prompt
      return (
        <div>
          <p>{msg.content.message}</p>
          <div className="sent-options">
            {msg.content.buttons?.map((b: any) => <span key={b.id} className="option-chip">{b.title}</span>)}
          </div>
        </div>
      );
    case 'interactive_list': // outbound: we sent a list prompt
      return (
        <div>
          <p>{msg.content.bodyText}</p>
          <div className="sent-options">
            {msg.content.listOfSections?.flatMap((s: any) => s.rows).map((r: any) => (
              <span key={r.id} className="option-chip">{r.title}</span>
            ))}
          </div>
        </div>
      );
    case 'location':
      return <p><MapPin size={14} style={{ verticalAlign: 'text-bottom', marginRight: 5 }} />Location shared{msg.content.name ? ` — ${msg.content.name}` : ''}</p>;
    case 'contact':
      return <p>Contact shared</p>;
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
      return <MediaBubble message={msg} />;
    default:
      return <p className="unsupported">Unsupported message type: {msg.type}</p>;
  }
}

function StatusTick({ status }: { status: string }) {
  if (status === 'failed') return <AlertTriangle size={13} className="status-icon failed" />;
  if (status === 'read') return <CheckCheck size={15} className="status-icon read" />;
  if (status === 'delivered') return <CheckCheck size={15} className="status-icon" />;
  if (status === 'sent') return <Check size={14} className="status-icon" />;
  return <Clock size={12} className="status-icon" />;
}

export default function ChatWindow({ contact, messages, onBack, onDetails }: { contact: any; messages: any[]; onBack?: () => void; onDetails?: () => void }) {
  const displayName = contact?.name ?? contact?.waName ?? contact?.waId ?? '?';
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.status]);

  return (
    <div className="chat-window">
      <div className="chat-header">
        {onBack && <button className="icon-btn back-btn" onClick={onBack}><ArrowLeft size={22} /></button>}
        <Avatar name={displayName} />
        <div>
          <div className="name">{displayName}</div>
          <div className="subtext">{contact?.waId}</div>
        </div>
        {onDetails && <button className="icon-btn details-btn" onClick={onDetails} aria-label="Open customer details"><PanelRight size={19} /></button>}
      </div>
      <div className="chat-thread">
        {messages.length === 0 && <div className="empty-state">No messages yet in this conversation.</div>}
        {messages.map((msg, i) => {
          const showTail = i === 0 || messages[i - 1].direction !== msg.direction;
          return (
            <div
              key={msg.id}
              className={`bubble-row ${msg.direction === 'inbound' ? 'inbound' : 'outbound'}`}
            >
              <div className={`bubble ${msg.direction === 'inbound' ? 'inbound' : 'outbound'} sender-${msg.senderType} ${showTail ? 'with-tail' : ''}`}>
                {msg.senderType !== 'customer' && msg.direction === 'outbound' && (
                  <span className="sender-tag">{msg.senderType}</span>
                )}
                {renderContent(msg)}
                <div className="bubble-meta">
                  <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {msg.direction === 'outbound' && <StatusTick status={msg.status} />}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
