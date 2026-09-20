// In single-service deployment (server serves the built client), leave VITE_API_URL unset and
// requests go to the same origin the app is served from. In local dev with two separate dev
// servers, set VITE_API_URL=http://localhost:4000 in client/.env.
const API_URL = import.meta.env.VITE_API_URL ?? '';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: isFormData ? options.headers : { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const flat = data?.error?.formErrors?.join(', ') || Object.values(data?.error?.fieldErrors ?? {}).flat().join(', ');
    const method = options.method ?? 'GET';
    // If the server didn't send a JSON error body at all (e.g. a route that doesn't exist),
    // name exactly which call failed instead of a bare "Request failed (404)" — this is the
    // detail needed to actually diagnose a 404/500 instead of guessing.
    throw new Error(flat || data?.error || `${method} ${path} failed (${res.status} ${res.statusText})`);
  }
  return data as T;
}

export function mediaUrl(mediaId: string) {
  return `${API_URL}/api/uploads/${mediaId}/content`;
}

export const api = {
  // Auth removed — /me always resolves to the single default tenant now (see server's
  // defaultTenant service), it's just fetched here for display (business name, etc).
  me: () => request<{ user: { id: string; name: string; email: string; role: string; businessId: string } }>('/api/auth/me'),

  getWaba: () => request<any>('/api/waba'),
  updateWaba: (body: Record<string, unknown>) => request('/api/waba', { method: 'PUT', body: JSON.stringify(body) }),
  testWabaConnection: (body: { testRecipientPhone?: string }) =>
    request<{ status: string; error?: string }>('/api/waba/test-connection', { method: 'POST', body: JSON.stringify(body) }),

  getStorage: () => request<any>('/api/storage'),
  updateStorage: (body: Record<string, unknown>) => request('/api/storage', { method: 'PUT', body: JSON.stringify(body) }),
  testStorage: (body: Record<string, unknown>) =>
    request<{ status: string; error?: string }>('/api/storage/test', { method: 'POST', body: JSON.stringify(body) }),

  getAiSettings: () => request<any>('/api/ai'),
  updateAiSettings: (body: Record<string, unknown>) => request('/api/ai', { method: 'PUT', body: JSON.stringify(body) }),
  testGroqKey: (apiKey: string) => request<{ ok: boolean }>('/api/ai/test-key', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  listGroqModels: () => request<{ models: string[] }>('/api/ai/models'),

  listConversations: (opts?: { status?: string; search?: string }) => {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.search) params.set('search', opts.search);
    const qs = params.toString();
    return request<any[]>(`/api/conversations${qs ? `?${qs}` : ''}`);
  },
  getConversation: (id: string) => request<any>(`/api/conversations/${id}`),
  markConversationRead: (id: string) => request(`/api/conversations/${id}/read`, { method: 'POST' }),
  updateConversation: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  sendText: (conversationId: string, message: string) =>
    request('/api/messages/text', { method: 'POST', body: JSON.stringify({ conversationId, message }) }),
  sendButtons: (conversationId: string, message: string, buttons: { title: string; id: string }[], headerText?: string, footerText?: string) =>
    request('/api/messages/buttons', { method: 'POST', body: JSON.stringify({ conversationId, message, buttons, headerText, footerText }) }),
  sendList: (conversationId: string, opts: {
    headerText?: string;
    bodyText: string;
    footerText?: string;
    actionTitle?: string;
    listOfSections: { title: string; rows: { title: string; description: string; id: string }[] }[];
  }) => request('/api/messages/list', { method: 'POST', body: JSON.stringify({ conversationId, ...opts }) }),
  sendMedia: (kind: 'image' | 'document' | 'video' | 'audio', conversationId: string, mediaId: string, caption?: string) =>
    request(`/api/messages/${kind}`, { method: 'POST', body: JSON.stringify({ conversationId, mediaId, caption }) }),

  uploadFile: (file: File | Blob, filename?: string) => {
    const form = new FormData();
    form.append('file', file, filename ?? (file instanceof File ? file.name : 'recording.webm'));
    return request<{ id: string; mimeType: string; filename: string }>('/api/uploads', { method: 'POST', body: form });
  },
  mediaForMessage: (messageId: string) => request<{ id: string; mimeType: string }>(`/api/uploads/for-message/${messageId}`),

  listTags: () => request<any[]>('/api/tags'),
  createTag: (name: string, color?: string) => request('/api/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
  deleteTag: (id: string) => request(`/api/tags/${id}`, { method: 'DELETE' }),
  assignTag: (tagId: string, conversationId: string) => request(`/api/tags/${tagId}/assign/${conversationId}`, { method: 'POST' }),
  unassignTag: (tagId: string, conversationId: string) => request(`/api/tags/${tagId}/assign/${conversationId}`, { method: 'DELETE' }),

  listNotes: (conversationId: string) => request<any[]>(`/api/notes/${conversationId}`),
  addNote: (conversationId: string, body: string) => request(`/api/notes/${conversationId}`, { method: 'POST', body: JSON.stringify({ body }) }),
  deleteNote: (noteId: string) => request(`/api/notes/entry/${noteId}`, { method: 'DELETE' }),

  listQuickReplies: () => request<any[]>('/api/quick-replies'),
  createQuickReply: (body: {
    shortcut: string;
    message: string;
    messageType?: 'text' | 'buttons' | 'list';
    payload?: Record<string, unknown>;
    category?: string;
  }) => request('/api/quick-replies', { method: 'POST', body: JSON.stringify(body) }),
  deleteQuickReply: (id: string) => request(`/api/quick-replies/${id}`, { method: 'DELETE' }),

  listAgents: () => request<any[]>('/api/agents'),

  getDashboard: () => request<any>('/api/dashboard'),
};
