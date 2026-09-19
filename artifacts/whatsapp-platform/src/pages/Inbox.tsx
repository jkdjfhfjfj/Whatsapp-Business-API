import { useEffect, useState, useCallback } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api';
import { useRealtime } from '../useRealtime';
import { useToast } from '../Toast';
import ConversationList, { ConversationListSkeleton } from '../components/ConversationList';
import ChatWindow from '../components/ChatWindow';
import Composer from '../components/Composer';
import TagPicker from '../components/TagPicker';
import NotesPanel from '../components/NotesPanel';

export default function Inbox({ businessId }: { businessId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ conversation: any; contact: any; messages: any[] } | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [agents, setAgents] = useState<any[]>([]);
  const [rightTab, setRightTab] = useState<'info' | 'notes'>('info');
  const [mobileView, setMobileView] = useState<'list' | 'chat' | 'details'>('list');
  const [updatingField, setUpdatingField] = useState<'status' | 'assign' | 'ai' | null>(null);

  const refreshList = useCallback(() => {
    api.listConversations({ status: filter || undefined, search: search || undefined })
      .then(setRows)
      .catch((err) => toast(err.message, 'error'))
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search]);

  useEffect(() => { refreshList(); }, [refreshList]);
  useEffect(() => { api.listAgents().then(setAgents).catch((err) => toast(err.message, 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshDetail() {
    if (selectedId) api.getConversation(selectedId).then(setDetail).catch((err) => toast(err.message, 'error'));
  }

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    refreshDetail();
    api.markConversationRead(selectedId).catch((err) => toast(err.message, 'error'));
    setMobileView('chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useRealtime(businessId, (event, payload: any) => {
    if (event === 'conversation:update' || event === 'message:new' || event === 'message:status') {
      refreshList();
      if (selectedId && (payload?.conversationId === selectedId || payload?.id === selectedId)) refreshDetail();
    }
  });

  // Every mutation below follows the same shape: a small loading flag, a success toast, and —
  // critically — a caught error that also surfaces as a toast. Previously several of these had
  // no catch at all, so a failed request produced no feedback whatsoever: the UI just silently
  // didn't update, with nothing in the console and nothing on screen.
  async function updateStatus(status: string) {
    if (!detail) return;
    setUpdatingField('status');
    try {
      const updated = await api.updateConversation(detail.conversation.id, { status });
      setDetail({ ...detail, conversation: updated });
      refreshList();
      toast('Status updated.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setUpdatingField(null);
    }
  }

  async function updateAssignment(assignedAgentId: string) {
    if (!detail) return;
    setUpdatingField('assign');
    try {
      const updated = await api.updateConversation(detail.conversation.id, { assignedAgentId: assignedAgentId || null });
      setDetail({ ...detail, conversation: updated });
      refreshList();
      toast(assignedAgentId ? 'Conversation assigned.' : 'Conversation unassigned.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setUpdatingField(null);
    }
  }

  async function toggleAi() {
    if (!detail) return;
    setUpdatingField('ai');
    try {
      const updated = await api.updateConversation(detail.conversation.id, { aiEnabled: !detail.conversation.aiEnabled });
      setDetail({ ...detail, conversation: updated });
      refreshList();
      toast(updated.aiEnabled ? 'AI handling enabled for this chat.' : 'Switched to human-only.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setUpdatingField(null);
    }
  }

  const windowExpired = detail?.conversation?.windowExpiresAt
    ? new Date(detail.conversation.windowExpiresAt).getTime() < Date.now()
    : false;

  const activeTagNames: string[] = rows.find((r) => r.conversation.id === selectedId)?.tagNames ?? [];

  return (
    <div className={`inbox-layout mobile-${mobileView}`}>
      <aside className="inbox-left">
        <div className="search-row">
          <Search size={16} />
          <input placeholder="Search chats…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="filter-row">
          {['', 'open', 'pending', 'resolved', 'archived'].map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f || 'All'}</button>
          ))}
        </div>
        {loadingList ? <ConversationListSkeleton /> : <ConversationList rows={rows} selectedId={selectedId} onSelect={setSelectedId} />}
      </aside>

      <section className="inbox-center">
        {detail ? (
          <>
             <ChatWindow contact={detail.contact} messages={detail.messages} onBack={() => setMobileView('list')} onDetails={() => setMobileView('details')} />
            <Composer
              conversationId={detail.conversation.id}
              disabled={windowExpired}
              onSent={refreshDetail}
            />
          </>
        ) : (
          <div className="empty-state">Select a conversation to view it here.</div>
        )}
      </section>

      <aside className="inbox-right">
        {detail ? (
          <>
            <div className="right-tabs">
              <button className={rightTab === 'info' ? 'active' : ''} onClick={() => setRightTab('info')}>Info</button>
              <button className={rightTab === 'notes' ? 'active' : ''} onClick={() => setRightTab('notes')}>Notes</button>
              <button className="icon-btn details-close" onClick={() => setMobileView('chat')} aria-label="Close customer details">×</button>
            </div>

            {rightTab === 'info' ? (
              <>
                <h3>Conversation</h3>
                <div className="detail-row">
                  <span>Status</span>
                  <select
                    value={detail.conversation.status}
                    disabled={updatingField === 'status'}
                    onChange={(e) => updateStatus(e.target.value)}
                  >
                    {['open', 'pending', 'resolved', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="detail-row">
                  <span>Assigned to</span>
                  <select
                    value={detail.conversation.assignedAgentId ?? ''}
                    disabled={updatingField === 'assign'}
                    onChange={(e) => updateAssignment(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="detail-row">
                  <span>AI handling</span>
                  <button className={`toggle ${detail.conversation.aiEnabled ? 'on' : 'off'}`} onClick={toggleAi} disabled={updatingField === 'ai'}>
                    {updatingField === 'ai' ? <span className="spinner" /> : (detail.conversation.aiEnabled ? 'AI ON' : 'Human only')}
                  </button>
                </div>
                <div className="detail-row">
                  <span>Service window</span>
                  <span className={windowExpired ? 'warn' : 'ok'}>
                    {windowExpired ? 'Expired' : `Active`}
                  </span>
                </div>

                <h3>Tags</h3>
                <TagPicker conversationId={detail.conversation.id} activeTagNames={activeTagNames} onChange={refreshList} />

                <h3>Customer</h3>
                <div className="detail-row"><span>WhatsApp name</span><span>{detail.contact.waName ?? '—'}</span></div>
                <div className="detail-row"><span>Phone</span><span>{detail.contact.waId}</span></div>
                <div className="detail-row"><span>CRM name</span><span>{detail.contact.name ?? '—'}</span></div>
              </>
            ) : (
              <NotesPanel conversationId={detail.conversation.id} />
            )}
          </>
        ) : (
          <div className="empty-state">No conversation selected.</div>
        )}
      </aside>
    </div>
  );
}
