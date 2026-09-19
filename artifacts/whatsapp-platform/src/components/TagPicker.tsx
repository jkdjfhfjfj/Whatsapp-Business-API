import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../Toast';

export default function TagPicker({ conversationId, activeTagNames, onChange }: {
  conversationId: string; activeTagNames: string[]; onChange: () => void;
}) {
  const toast = useToast();
  const [allTags, setAllTags] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [busyTagId, setBusyTagId] = useState<string | null>(null);

  useEffect(() => { api.listTags().then(setAllTags).catch((err) => toast(err.message, 'error')); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleTag(tag: any) {
    setBusyTagId(tag.id);
    try {
      if (activeTagNames.includes(tag.name)) {
        await api.unassignTag(tag.id, conversationId);
      } else {
        await api.assignTag(tag.id, conversationId);
      }
      onChange();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusyTagId(null);
    }
  }

  async function createTag() {
    if (!newTagName.trim()) return;
    try {
      const tag = await api.createTag(newTagName.trim());
      setAllTags((t) => [...t, tag]);
      await api.assignTag((tag as any).id, conversationId);
      setNewTagName('');
      setCreating(false);
      onChange();
      toast('Tag created and applied.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="tag-picker">
      <div className="tag-chip-row">
        {allTags.map((tag) => (
          <button
            key={tag.id}
            className={`tag-chip toggle ${activeTagNames.includes(tag.name) ? 'active' : ''}`}
            style={activeTagNames.includes(tag.name) ? { background: tag.color, color: 'white' } : undefined}
            onClick={() => toggleTag(tag)}
            disabled={busyTagId === tag.id}
          >
            {tag.name}
          </button>
        ))}
        {creating ? (
          <span className="tag-create-row">
            <input autoFocus value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createTag()} placeholder="Tag name" />
            <button className="icon-btn" onClick={createTag}><Plus size={14} /></button>
            <button className="icon-btn" onClick={() => setCreating(false)}><X size={14} /></button>
          </span>
        ) : (
          <button className="tag-chip add" onClick={() => setCreating(true)}><Plus size={12} /> Tag</button>
        )}
      </div>
    </div>
  );
}
