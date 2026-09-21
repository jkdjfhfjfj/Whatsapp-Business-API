import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Trash2 } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../Toast';

export default function Settings() {
  const [location] = useLocation();
  const tabs = [
    ['waba', 'WhatsApp'],
    ['storage', 'Storage'],
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
          : location.endsWith('/storage') ? <StorageSettings />
          : location.endsWith('/tags') ? <TagsSettings />
            : location.endsWith('/quick-replies') ? <QuickRepliesSettings />
              : <WabaSettings />}
      </div>
    </div>
  );
}

function StorageSettings() {
  const toast = useToast();
  const [form, setForm] = useState<any>({ provider: 'local' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.getStorage().then((d) => setForm(d ?? { provider: 'local' })).catch(() => setLoadError(true)).finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.updateStorage(form);
      const refreshed = await api.getStorage();
      setForm(refreshed ?? { provider: 'local' });
      toast('Storage settings saved.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setStatus('testing');
    try {
      const result = await api.testStorage(form);
      setStatus(result.status);
      toast(result.status === 'connected' ? 'Storage connection successful.' : `Status: ${result.status}`, result.status === 'connected' ? 'success' : 'error');
    } catch (err) {
      setStatus('api_error');
      toast((err as Error).message, 'error');
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <div className="settings-card"><div className="empty-state">Loading storage settings</div></div>;
  if (loadError) return <div className="settings-card"><div className="empty-state"><strong>Storage settings could not load</strong><button className="primary-action" onClick={() => window.location.reload()}>Retry</button></div></div>;

  return (
    <div className="settings-card">
      <h2>Media storage</h2>
      <p className="subtext">
        Choose where uploaded and inbound WhatsApp media is stored. Cloudinary keeps media independent
        of the Render disk and is tested with a temporary upload.
      </p>

      <label>Provider
        <select value={form.provider ?? 'local'} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
          <option value="local">Render persistent disk</option>
          <option value="cloudinary">Cloudinary API</option>
          <option value="github">GitHub Contents API</option>
        </select>
      </label>

      {form.provider === 'cloudinary' && (
        <>
          <label>Cloudinary cloud name
            <input value={form.cloudName ?? ''} onChange={(e) => setForm({ ...form, cloudName: e.target.value })} placeholder="your-cloud-name" />
          </label>
          <label>Cloudinary API key
            <input value={form.apiKey ?? ''} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="123456789012345" />
          </label>
          <label>Cloudinary API secret {form.apiSecretMasked && <span className="masked">({form.apiSecretMasked} saved)</span>}
            <input type="password" placeholder="Enter to replace" onChange={(e) => setForm({ ...form, apiSecret: e.target.value })} />
          </label>
        </>
      )}

      <div className="row-with-button">
        <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save storage settings'}</button>
        <button type="button" onClick={test} disabled={testing}>{testing ? 'Testing…' : 'Test storage API'}</button>
      </div>
      {status && <div className={`status-banner ${status}`}>Status: {status}</div>}
    </div>
  );
}

function WabaSettings() {
  const toast = useToast();
  const [form, setForm] = useState<any>({});
  const [profile, setProfile] = useState<any>({});
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [pictureUploading, setPictureUploading] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getWaba().then((d) => setForm(d ?? {})),
      api.getWabaProfile().then((d) => setProfile(d ?? {})).catch(() => {}),
    ]).catch(() => setLoadError(true)).finally(() => { setLoading(false); setProfileLoading(false); });
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

  async function saveProfile() {
    setProfileSaving(true);
    try {
      const websites = [profile.website1, profile.website2].map((url: string) => url?.trim()).filter(Boolean);
      const refreshed = await api.updateWabaProfile({
        about: profile.about ?? '',
        address: profile.address ?? '',
        description: profile.description ?? '',
        email: profile.email ?? '',
        vertical: profile.vertical ?? '',
        websites,
      });
      setProfile(refreshed ?? {});
      toast('Meta business profile saved.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setProfileSaving(false);
    }
  }

  async function uploadProfilePicture(file?: File) {
    if (!file) return;
    setPictureUploading(true);
    try {
      const refreshed = await api.uploadWabaProfilePicture(file);
      setProfile(refreshed ?? {});
      toast('Meta profile picture updated.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPictureUploading(false);
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
      <h3>Meta business profile</h3>
      <p className="subtext">Edit the profile customers see in WhatsApp. Meta supports the fields below and up to two website URLs.</p>
      {profileLoading ? <div className="empty-state">Loading Meta profile…</div> : (
        <>
          {profile.profile_picture_url && <img className="profile-picture-preview" src={profile.profile_picture_url} alt="Current WhatsApp business profile" />}
          <label>Profile picture (JPG or PNG, up to 5 MB)
            <input type="file" accept="image/jpeg,image/png" disabled={pictureUploading} onChange={(e) => uploadProfilePicture(e.target.files?.[0])} />
          </label>
          <label>About <span className="field-hint">(1-139 characters)</span><input maxLength={139} value={profile.about ?? ''} onChange={(e) => setProfile({ ...profile, about: e.target.value })} /></label>
          <label>Address <span className="field-hint">(up to 256 characters)</span><input maxLength={256} value={profile.address ?? ''} onChange={(e) => setProfile({ ...profile, address: e.target.value })} /></label>
          <label>Description <span className="field-hint">(up to 512 characters)</span><textarea maxLength={512} rows={3} value={profile.description ?? ''} onChange={(e) => setProfile({ ...profile, description: e.target.value })} /></label>
          <label>Contact email<input type="email" maxLength={128} value={profile.email ?? ''} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></label>
          <label>Business category
            <select value={profile.vertical ?? ''} onChange={(e) => setProfile({ ...profile, vertical: e.target.value })}>
              <option value="">Not specified</option>
              {['ALCOHOL', 'APPAREL', 'AUTO', 'BEAUTY', 'EDU', 'ENTERTAIN', 'EVENT_PLAN', 'FINANCE', 'GOVT', 'GROCERY', 'HEALTH', 'HOTEL', 'NONPROFIT', 'ONLINE_GAMBLING', 'OTC_DRUGS', 'OTHER', 'PHYSICAL_GAMBLING', 'PROF_SERVICES', 'RESTAURANT', 'RETAIL', 'TRAVEL'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
          <label>Website 1<input type="url" value={profile.website1 ?? profile.websites?.[0] ?? ''} onChange={(e) => setProfile({ ...profile, website1: e.target.value })} placeholder="https://example.com" /></label>
          <label>Website 2<input type="url" value={profile.website2 ?? profile.websites?.[1] ?? ''} onChange={(e) => setProfile({ ...profile, website2: e.target.value })} placeholder="https://instagram.com/your-business" /></label>
          <button onClick={saveProfile} disabled={profileSaving}>{profileSaving ? 'Saving profile…' : 'Save Meta profile'}</button>
        </>
      )}

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
  const [messageType, setMessageType] = useState<'text' | 'buttons' | 'list'>('text');
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [buttonLines, setButtonLines] = useState('');
  const [rowLines, setRowLines] = useState('');
  const [busy, setBusy] = useState(false);

  function refresh() { api.listQuickReplies().then(setReplies).catch((err) => toast(err.message, 'error')); }
  useEffect(refresh, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (!shortcut.trim() || !message.trim()) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      if (messageType === 'buttons') {
        const buttons = buttonLines.split('\n').map((line) => {
          const [title, id, link] = line.split('|').map((part) => part.trim());
          return { title, id, link };
        }).filter((button) => button.title && (button.id || button.link));
        if (buttons.length < 1 || buttons.length > 3) {
          toast('Add 1-3 buttons, one per line as Title | reply-id | optional-link.', 'error');
          return;
        }
        payload.buttons = buttons;
        if (headerText.trim()) payload.headerText = headerText.trim();
        if (footerText.trim()) payload.footerText = footerText.trim();
      } else if (messageType === 'list') {
        const rows = rowLines.split('\n').map((line) => {
          const [title, description, id] = line.split('|').map((part) => part.trim());
          return { title, description, id };
        }).filter((row) => row.title && row.description && row.id);
        if (rows.length < 1 || rows.length > 10) {
          toast('Add 1-10 rows, one per line as Title | description | id.', 'error');
          return;
        }
        payload.headerText = headerText.trim();
        payload.footerText = footerText.trim();
        payload.actionTitle = 'View options';
        payload.listOfSections = [{ title: 'Options', rows }];
      }
      await api.createQuickReply({
        shortcut: shortcut.trim().startsWith('/') ? shortcut.trim() : `/${shortcut.trim()}`,
        message: message.trim(),
        messageType,
        payload,
      });
      setShortcut('');
      setMessage('');
      setMessageType('text');
      setHeaderText('');
      setFooterText('');
      setButtonLines('');
      setRowLines('');
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
      <p className="subtext">Agents type <code>/shortcut</code> in the composer to insert text, button, or list messages.</p>
      <label>Shortcut<input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="hello" /></label>
      <label>Message type
        <select value={messageType} onChange={(e) => setMessageType(e.target.value as 'text' | 'buttons' | 'list')}>
          <option value="text">Text</option>
          <option value="buttons">Buttons</option>
          <option value="list">List</option>
        </select>
      </label>
      <label>{messageType === 'list' ? 'List body' : messageType === 'buttons' ? 'Button message' : 'Message'}
        <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hello! How can we help you today?" />
      </label>
      {messageType !== 'text' && (
        <>
          <label>Header (optional)<input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Header text" /></label>
          <label>Footer (optional)<input value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Footer text" /></label>
        </>
      )}
      {messageType === 'buttons' && (
        <label>Buttons, one per line: title | reply-id | optional-link
          <textarea rows={3} value={buttonLines} onChange={(e) => setButtonLines(e.target.value)} placeholder={'See products | see_products\nTalk to a human | talk_to_human'} />
        </label>
      )}
      {messageType === 'list' && (
        <label>Rows, one per line: title | description | id
          <textarea rows={4} value={rowLines} onChange={(e) => setRowLines(e.target.value)} placeholder={'Delivery | Check delivery status | delivery\nReturns | Start a return | returns'} />
        </label>
      )}
      <button onClick={create} disabled={busy}>{busy ? <span className="spinner" /> : 'Add quick reply'}</button>
      <ul className="settings-list">
         {replies.length === 0 && <li className="empty-list-state">No quick replies yet. Add a shortcut agents can use in the inbox.</li>}
         {replies.map((r) => (
          <li key={r.id}>
             <div><strong>{r.shortcut}</strong> <span className="tag-chip">{r.messageType ?? 'text'}</span> — {r.message}</div>
            <button className="icon-btn" onClick={() => remove(r.id)}><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
