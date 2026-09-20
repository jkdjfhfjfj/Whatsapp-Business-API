import { useEffect, useState } from 'react';
import { FileText, Download } from 'lucide-react';
import { api, mediaUrl } from '../api';
import { mediaContent, normalizedMessageType } from '../messageTypes';

// Inbound messages only carry a WhatsApp media id until viewed (Meta's URLs expire fast), so we
// resolve+cache it through /api/uploads/for-message the first time this bubble renders.
// Outbound messages already know their local mediaId from the send response.
export default function MediaBubble({ message }: { message: any }) {
  const type = normalizedMessageType(message);
  const content = mediaContent(message, type as any);
  const [mediaId, setMediaId] = useState<string | null>(message.content?.mediaId ?? message.content?.body?.mediaId ?? null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mediaId || message.direction !== 'inbound') return;
    api.mediaForMessage(message.id)
      .then((m) => { setMediaId(m.id); setMimeType(m.mimeType); })
      .catch((err) => setError(err.message));
  }, [message.id, message.direction, mediaId]);

  if (error) {
    return <div className="media-bubble media-error">Couldn't load media: {error}</div>;
  }
  if (!mediaId) {
    return <div className="media-bubble media-loading">Loading {message.type}…</div>;
  }

  const url = mediaUrl(mediaId);
  const caption = content?.caption;

  switch (type) {
    case 'image':
      return (
        <div className="media-bubble">
          <img src={url} alt={caption ?? 'Image'} loading="lazy" />
          {caption && <p className="media-caption">{caption}</p>}
        </div>
      );
    case 'video':
      return (
        <div className="media-bubble">
          <video src={url} controls preload="metadata" />
          {caption && <p className="media-caption">{caption}</p>}
        </div>
      );
    case 'audio':
      return (
        <div className="media-bubble media-audio">
          <audio src={url} controls />
        </div>
      );
    case 'document':
      return (
          <a className="media-bubble media-document" href={url} download={content?.filename ?? true} target="_blank" rel="noreferrer">
          <FileText size={22} />
          <span>{content?.filename ?? 'Document'}</span>
          <Download size={16} />
        </a>
      );
    default:
      return <div className="media-bubble">{mimeType ?? message.type}</div>;
  }
}
