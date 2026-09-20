import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Trash2 } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../Toast';

export default function Settings() {
  const [location] = useLocation();
  const tabs = [
    ['waba', 'WhatsApp'],
    ['ai', 'AI'],
    ['tags', 'Tags'],
    ['quick-replies', 'Quick Replies'],
  ];
  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        {tabs.map(([path, label]) => (
          <Link key={path} className={(location.endsWith(path) || (path === 'waba' && location === '/settings')) ? 'active' : ''} href={`/settings/${path}`}>{label}</Link>
        ))}
      </nav>
      <div className="settings-content">
        {location.endsWith('/ai') ? <AiSettings />
          : location.endsWith('/tags') ? <TagsSettings />
            : location.endsWith('/quick-replies') ? <QuickRepliesSettings />
              : <WabaSettings />}
      </div>
    </div>
  );
}

function WabaSettings() {
  const toast = useToast();
  const [form, setForm] = useState<any>({});
  const [testPhone, setTestPhone] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    api.getWaba().then((d) => setForm(d ?? {})).catch(() => setLoadError(true)).finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.updateWaba(form);
      const refreshed = await api.getWaba();
      setForm(refreshed ?? {});
      toast('WhatsApp settings saved.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setStatus('testing');
    try {
      const res = await api.testWabaConnection({ testRecipientPhone: testPhone || undefined });
      setStatus(res.status);
      toast(res.status === 'connected' ? 'Connection successful!' : `Status: ${res.status}`, res.status === 'connected' ? 'success' : 'error');
    } catch (err) {
      setStatus('api_error');
      toast((err as Error).message, 'error');
    }
  }

  if (loading) return <div className="settings-card"><div className="skeleton skeleton-line" style={{ width: 220, height: 22 }} /><div className="empty-state">Loading WhatsApp connection</div></div>;
  if (loadError) return <div className="settings-card"><div className="empty-state"><strong>Connection settings could not load</strong><button className="primary-action" onClick={() => window.location.reload()}>Retry</button></div></div>;

  return (
    <div className="settings-card">
      <h2>WhatsApp Business Platform</h2>
      <p className="subtext">
        Set your webhook URL in the Meta App Dashboard to <code>https://your-app-url/webhook</code> using
        the verify token below.
      </p>

      <label>Meta App ID<input value={form.appId ?? ''} onChange={(e) => setForm({ ...form, appId: e.target.value })} /></label>
      <label>Meta App Secret {form.appSecretMasked && <span className="masked">({form.appSecretMasked} saved)</span>}
        <input type="password" placeholder="Enter to replace" onChange={(e) => setForm({ ...form, appSecret: e.target.value })} />
      </label>
      <label>Permanent Access Token {form.accessTokenMasked && <span className="masked">({form.accessTokenMasked} saved)</span>}
        <input type="password" placeholder="Enter to replace" onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
      </label>
      <label>WABA ID<input value={form.wabaId ?? ''} onChange={(e) => setForm({ ...form, wabaId: e.target.value })} /></label>
      <label>Phone Number ID<input value={form.phoneNumberId ?? ''} onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })} /></label>
      <label>Display Phone Number<input value={form.displayPhoneNumber ?? ''} onChange={(e) => setForm({ ...form, displayPhoneNumber: e.target.value })} /></label>
      <label>Webhook Verify Token<input value={form.webhookVerifyToken ?? ''} onChange={(e) => setForm({ ...form, webhookVerifyToken: e.target.value })} /></label>
      <label>API Version<input value={form.apiVersion ?? 'v20.0'} onChange={(e) => setForm({ ...form, apiVersion: e.target.value })} /></label>

      <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>

      <hr />
      <h3>Test connection</h3>
      <label>Send a test message to (optional, international format, no +)
        <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="254712345678" />
      </label>
       <button onClick={testConnection} disabled={status === 'testing'}>{status === 'testing' ? 'Testing…' : 'Test connection'}</button>
      {status && <div className={`status-banner ${status}`}>Status: {status}</div>}
    </div>
  );
}

function AiSettings() {
  const toast = useToast();
  const [form, setForm] = useState<any>({});
  const [models, setModels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [keyTest, setKeyTest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    api.getAiSettings().then((d) => setForm(d ?? {})).catch(() => setLoadError(true)).finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.updateAiSettings(form);
      const refreshed = await api.getAiSettings();
      setForm(refreshed ?? {});
      toast('AI settings saved.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function testKey() {
    if (!form.groqApiKey) { toast('Enter a key first.', 'error'); return; }
    setKeyTest('testing');
    try {
      const { ok } = await api.testGroqKey(form.groqApiKey);
      setKeyTest(ok ? 'valid' : 'invalid');
      if (!ok) toast('Groq rejected this API key.', 'error');
    } catch (err) {
      setKeyTest('invalid');
      toast((err as Error).message, 'error');
    }
  }

  async function loadModels() {
    try {
      const { models } = await api.listGroqModels();
      setModels(models);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  if (loading) return <div className="settings-card"><div className="skeleton skeleton-line" style={{ width: 180, height: 22 }} /><div className="empty-state">Loading AI controls</div></div>;
  if (loadError) return <div className="settings-card"><div className="empty-state"><strong>AI settings could not load</strong><button className="primary-action" onClick={() => window.location.reload()}>Retry</button></div></div>;

  return (
    <div className="settings-card">
      <h2>AI Assistant (Groq)</h2>

      <label className="checkbox-row">
        <input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
        Enable AI auto-replies
      </label>

      <label>Groq API key {form.groqApiKeyMasked && <span className="masked">({form.groqApiKeyMasked} saved)</span>}
        <input type="password" placeholder="Enter to replace" onChange={(e) => setForm({ ...form, groqApiKey: e.target.value })} />
      </label>
      <button type="button" onClick={testKey}>Test key</button>
      {keyTest && <span className={`inline-status ${keyTest}`}>{keyTest}</span>}

      <label>Model
        <div className="row-with-button">
          <input value={form.model ?? ''} onChange={(e) => setForm({ ...form, model: e.target.value })} list="groq-models" />
          <button type="button" onClick={loadModels}>Fetch available models</button>
        </div>
        <datalist id="groq-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
      </label>

      <label>Temperature ({form.temperature ?? 0.4})
        <input type="range" min={0} max={1} step={0.05} value={form.temperature ?? 0.4}
          onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} />
      </label>
      <label>Max response tokens
        <input type="number" min={1} max={4096} value={form.maxTokens ?? 400}
          onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })} />
      </label>
      <label>Top-p
        <input type="number" min={0} max={1} step={0.05} value={form.topP ?? 1}
          onChange={(e) => setForm({ ...form, topP: Number(e.target.value) })} />
      </label>

      <label>System prompt
        <textarea rows={5} value={form.systemPrompt ?? ''} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} />
      </label>
      <label>Business context (products, policies, FAQs)
        <textarea rows={4} value={form.businessContext ?? ''} onChange={(e) => setForm({ ...form, businessContext: e.target.value })} />
      </label>
      <label>Restricted topics (comma-separated)
        <input value={form.restrictedTopics ?? ''} onChange={(e) => setForm({ ...form, restrictedTopics: e.target.value })} />
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={!!form.pauseAfterHumanReply}
          onChange={(e) => setForm({ ...form, pauseAfterHumanReply: e.target.checked })} />
        Pause AI automatically after a human agent replies
      </label>

      {form.compiledPromptPreview && (
        <div className="compiled-preview">
          <h4>Compiled system prompt preview (sent to Groq)</h4>
          <pre>{form.compiledPromptPreview}</pre>
        </div>
      )}

      <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save AI settings'}</button>
    </div>
  );
}

function TagsSettings() {
  const toast = useToast();
  const [tags, setTags] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  function refresh() { api.listTags().then(setTags).catch((err) => toast(err.message, 'error')); }
  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createTag(name.trim());
      setName('');
      refresh();
      toast('Tag added.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteTag(id);
      refresh();
      toast('Tag deleted.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="settings-card">
      <h2>Tags</h2>
      <p className="subtext">Organize conversations — VIP, Billing, Refund, Sales, etc.</p>
      <div className="row-with-button">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag name" onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button onClick={create} disabled={busy}>{busy ? <span className="spinner" /> : 'Add tag'}</button>
      </div>
      <ul className="settings-list">
         {tags.length === 0 && <li className="empty-list-state">No tags yet. Add one to organize conversations.</li>}
         {tags.map((t) => (
          <li key={t.id}>
            <span className="tag-chip" style={{ background: t.color, color: 'white' }}>{t.name}</span>
            <button className="icon-btn" onClick={() => remove(t.id)}><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuickRepliesSettings() {
  const toast = useToast();
  const [replies, setReplies] = useState<any[]>([]);
  const [shortcut, setShortcut] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  function refresh() { api.listQuickReplies().then(setReplies).catch((err) => toast(err.message, 'error')); }
  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (!shortcut.trim() || !message.trim()) return;
    setBusy(true);
    try {
      await api.createQuickReply(shortcut.trim().startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`, message.trim());
      setShortcut('');
      setMessage('');
      refresh();
      toast('Quick reply added.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteQuickReply(id);
      refresh();
      toast('Quick reply deleted.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="settings-card">
      <h2>Quick Replies</h2>
      <p className="subtext">Agents type <code>/shortcut</code> in the composer to insert these instantly.</p>
      <label>Shortcut<input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="hello" /></label>
      <label>Message<textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hello! How can we help you today?" /></label>
      <button onClick={create} disabled={busy}>{busy ? <span className="spinner" /> : 'Add quick reply'}</button>
      <ul className="settings-list">
         {replies.length === 0 && <li className="empty-list-state">No quick replies yet. Add a shortcut agents can use in the inbox.</li>}
         {replies.map((r) => (
          <li key={r.id}>
            <div><strong>{r.shortcut}</strong> — {r.message}</div>
            <button className="icon-btn" onClick={() => remove(r.id)}><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
