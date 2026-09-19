import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../Toast';

export default function NotesPanel({ conversationId }: { conversationId: string }) {
  const toast = useToast();
  const [notes, setNotes] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function refresh() { api.listNotes(conversationId).then(setNotes).catch((err) => toast(err.message, 'error')); }
  useEffect(refresh, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await api.addNote(conversationId, draft.trim());
      setDraft('');
      refresh();
      toast('Note added.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(noteId: string) {
    setDeletingId(noteId);
    try {
      await api.deleteNote(noteId);
      refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="notes-panel">
      <div className="notes-list">
        {notes.length === 0 && <p className="subtext">No internal notes yet.</p>}
        {notes.map((n) => (
          <div key={n.id} className="note-item">
            <p>{n.body}</p>
            <div className="note-item-footer">
              <span className="subtext">{new Date(n.createdAt).toLocaleString()}</span>
              <button className="icon-btn" onClick={() => remove(n.id)} disabled={deletingId === n.id} aria-label="Delete note">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="note-composer">
        <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an internal note (not visible to the customer)…" />
        <button onClick={submit} disabled={saving || !draft.trim()}>{saving ? <span className="spinner" /> : 'Add note'}</button>
      </div>
    </div>
  );
}
