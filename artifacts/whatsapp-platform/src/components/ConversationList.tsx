import Avatar from './Avatar';

type Row = { conversation: any; contact: any; tagNames?: string[] };

export function ConversationListSkeleton() {
  return (
    <ul className="conversation-list">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="conversation-item skeleton-item">
          <div className="skeleton skeleton-avatar" />
          <div className="conversation-meta">
            <div className="skeleton skeleton-line" style={{ width: '60%' }} />
            <div className="skeleton skeleton-line" style={{ width: '40%', marginTop: 8 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ConversationList({
  rows, selectedId, onSelect,
}: { rows: Row[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p>No conversations yet.</p>
        <p className="subtext">They'll appear here as soon as a customer messages your WhatsApp number.</p>
      </div>
    );
  }

  return (
    <ul className="conversation-list">
      {rows.map(({ conversation, contact, tagNames }) => {
        const displayName = contact.name ?? contact.waName ?? contact.waId;
        const online = isRecentlyActive(contact.lastContactAt);
        return (
          <li
            key={conversation.id}
            className={`conversation-item ${conversation.id === selectedId ? 'selected' : ''}`}
            onClick={() => onSelect(conversation.id)}
            data-testid={`conversation-${conversation.id}`}
          >
            <Avatar name={displayName} />
            <div className="conversation-meta">
              <div className="conversation-top">
                <span className="name"><span className={`presence-dot ${online ? 'online' : 'offline'}`} />{displayName}</span>
                <span className="timestamp">
                  {conversation.updatedAt ? new Date(conversation.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
              <div className="conversation-bottom">
                <span className={`ai-pill ${conversation.aiEnabled ? 'on' : 'off'}`}>{conversation.aiEnabled ? 'AI' : 'Human'}</span>
                <span className="status-pill">{conversation.status}</span>
                {tagNames?.slice(0, 2).map((t) => <span key={t} className="tag-chip">{t}</span>)}
                {conversation.unreadCount > 0 && <span className="unread-badge">{conversation.unreadCount}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function isRecentlyActive(value: unknown) {
  if (!value) return false;
  const timestamp = new Date(String(value)).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < 5 * 60 * 1000;
}
