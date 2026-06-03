import { useState, useCallback, useRef, useEffect } from 'react';
import type { SignInstance } from '../platform/index.ts';

/* ── Types ─────────────────────────────────────────────────────────── */
export interface Comment {
  id: string;
  text: string;
  author: string;
  ts: number;
  resolved?: boolean;
}

export interface ActivityEntry {
  signId: string;
  action: 'approved' | 'edited' | 'flagged';
  reviewer: string;
  ts: number;
}

/* ── Local storage helpers (placeholder until Firebase) ──────────── */
const COMMENTS_KEY = 'sosisu:signal:comments';
const ACTIVITY_KEY = 'sosisu:signal:activity';

function loadComments(signId: string): Comment[] {
  try {
    const all = JSON.parse(localStorage.getItem(COMMENTS_KEY) || '{}');
    return all[signId] || [];
  } catch { return []; }
}

function saveComments(signId: string, comments: Comment[]) {
  try {
    const all = JSON.parse(localStorage.getItem(COMMENTS_KEY) || '{}');
    all[signId] = comments;
    localStorage.setItem(COMMENTS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

function loadActivity(): ActivityEntry[] {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
  } catch { return []; }
}

export function logActivity(entry: Omit<ActivityEntry, 'ts'>) {
  const list = loadActivity();
  list.unshift({ ...entry, ts: Date.now() });
  if (list.length > 50) list.length = 50;
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(list));
}

/* ── Time formatting ──────────────────────────────────────────────── */
function timeAgo(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function displaySignId(id: string): string {
  if (id.startsWith('si-cu-')) return `SD-${id.replace('si-cu-', '')}`;
  return id;
}

/* ── Building data helpers ─────────────────────────────────────────── */
interface BuildingEntry {
  name: string;
  count: number;
  zones: string[];
  signIds: string[];
}

function computeBuildingData(instances: SignInstance[]): BuildingEntry[] {
  const map = new Map<string, BuildingEntry>();
  for (const inst of instances) {
    for (const side of inst.sides) {
      for (const dest of side.destinations) {
        if (!dest.name) continue;
        const key = dest.name.toLowerCase().trim();
        const entry = map.get(key) || { name: dest.name, count: 0, zones: [], signIds: [] };
        entry.count++;
        if (inst.neighborhood && !entry.zones.includes(inst.neighborhood)) {
          entry.zones.push(inst.neighborhood);
        }
        if (!entry.signIds.includes(inst.id)) {
          entry.signIds.push(inst.id);
        }
        map.set(key, entry);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/* ── Props ─────────────────────────────────────────────────────────── */
interface Props {
  instance: SignInstance | null;
  allInstances: SignInstance[];
  reviewerName: string | null;
  onRequireReviewer: () => Promise<string | null>;
  onBuildingNames: () => void;
  onMapOverview: () => void;
  onExport: () => void;
  onGoToSign?: (id: string) => void;
}

/* ── Component ─────────────────────────────────────────────────────── */
export function RightPanel({
  instance,
  allInstances,
  reviewerName,
  onRequireReviewer,
  onBuildingNames,
  onMapOverview,
  onExport,
  onGoToSign,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [discussionOpen, setDiscussionOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(true);
  const [showPanel, setShowPanel] = useState<'none' | 'names' | 'freq'>('none');
  const inputRef = useRef<HTMLInputElement>(null);

  // Load comments when sign changes
  useEffect(() => {
    if (instance) {
      setComments(loadComments(instance.id));
    } else {
      setComments([]);
    }
    setActivity(loadActivity());
  }, [instance?.id, instance?.updatedAt]);

  // Refresh activity periodically
  useEffect(() => {
    const t = setInterval(() => setActivity(loadActivity()), 5000);
    return () => clearInterval(t);
  }, []);

  const postComment = useCallback(async () => {
    if (!commentText.trim() || !instance) return;
    let name = reviewerName;
    if (!name) {
      name = await onRequireReviewer();
      if (!name) return;
    }
    const newComment: Comment = {
      id: `c-${Date.now()}`,
      text: commentText.trim(),
      author: name,
      ts: Date.now(),
    };
    const updated = [...comments, newComment];
    setComments(updated);
    saveComments(instance.id, updated);
    setCommentText('');
  }, [commentText, instance, reviewerName, onRequireReviewer, comments]);

  const resolveComment = useCallback((commentId: string) => {
    if (!instance) return;
    const updated = comments.map((c) =>
      c.id === commentId ? { ...c, resolved: !c.resolved } : c,
    );
    setComments(updated);
    saveComments(instance.id, updated);
  }, [instance, comments]);

  const deleteComment = useCallback((commentId: string) => {
    if (!instance) return;
    const updated = comments.filter((c) => c.id !== commentId);
    setComments(updated);
    saveComments(instance.id, updated);
  }, [instance, comments]);

  const unresolvedCount = comments.filter((c) => !c.resolved).length;

  return (
    <aside className="right-panel">
      <div className="rp-scroll">
        {/* ── Discussion ── */}
        <div className={`rp-section${discussionOpen ? '' : ' collapsed'}`}>
          <div
            className="rp-section-header"
            onClick={() => setDiscussionOpen((v) => !v)}
          >
            <span className="rp-section-title">Discussion</span>
            {unresolvedCount > 0 && (
              <span className="rp-comment-count">{unresolvedCount}</span>
            )}
            <span className="rp-chevron">{'▼'}</span>
          </div>
          {discussionOpen && (
            <div className="rp-section-body">
              <div className="comment-thread">
                {comments.length === 0 && (
                  <div className="comment-empty">No comments yet</div>
                )}
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className={`comment-item${c.resolved ? ' resolved' : ''}`}
                  >
                    <div className="comment-meta">
                      <strong>{c.author}</strong>
                      <span className="comment-time">{timeAgo(c.ts)}</span>
                      <span className="comment-actions">
                        <button
                          className="comment-action-btn"
                          onClick={() => resolveComment(c.id)}
                        >
                          {c.resolved ? 'reopen' : 'resolve'}
                        </button>
                        <button
                          className="comment-action-btn"
                          onClick={() => deleteComment(c.id)}
                        >
                          delete
                        </button>
                      </span>
                    </div>
                    <div className="comment-text">{c.text}</div>
                  </div>
                ))}
              </div>
              <div className="comment-input-row">
                <input
                  ref={inputRef}
                  className="comment-input"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && postComment()}
                  placeholder="Add a comment..."
                  maxLength={500}
                />
                <button className="comment-send-btn" onClick={postComment}>
                  Post
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Activity ── */}
        <div className={`rp-section${activityOpen ? '' : ' collapsed'}`}>
          <div
            className="rp-section-header"
            onClick={() => setActivityOpen((v) => !v)}
          >
            <span className="rp-section-title">Activity</span>
            <span className="rp-chevron">{'▼'}</span>
          </div>
          {activityOpen && (
            <div className="rp-section-body">
              <div className="activity-list">
                {activity.length === 0 && (
                  <div className="comment-empty">No activity yet</div>
                )}
                {activity.map((a, i) => (
                  <div
                    key={`${a.ts}-${i}`}
                    className="activity-item"
                    onClick={() => onGoToSign?.(a.signId)}
                    style={onGoToSign ? { cursor: 'pointer' } : undefined}
                  >
                    <strong>{a.reviewer}</strong>{' '}
                    <span className={`act-${a.action}`}>{a.action}</span>{' '}
                    {displaySignId(a.signId)}
                    <span className="activity-time">{timeAgo(a.ts)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Building names / frequency overlay ── */}
      {showPanel !== 'none' && (
        <div className="rp-overlay">
          <div className="rp-overlay-header">
            <span className="rp-section-title">
              {showPanel === 'names' ? 'Building Names' : 'Building Frequency'}
            </span>
            <button
              className="rp-overlay-close"
              onClick={() => setShowPanel('none')}
            >
              {'×'}
            </button>
          </div>
          <div className="rp-overlay-body">
            {(() => {
              const data = computeBuildingData(allInstances);
              if (data.length === 0) {
                return <div className="comment-empty">No destination data</div>;
              }
              return (
                <table className="building-table">
                  <thead>
                    <tr>
                      <th>{showPanel === 'names' ? 'Name' : 'Building'}</th>
                      <th style={{ width: 50, textAlign: 'right' }}>
                        {showPanel === 'freq' ? 'Refs' : 'Signs'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((b) => (
                      <tr key={b.name}>
                        <td>
                          <div className="building-name">{b.name}</div>
                          {showPanel === 'names' && b.zones.length > 0 && (
                            <div className="building-zones">
                              {b.zones.join(', ')}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          {showPanel === 'freq' ? b.count : b.signIds.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 500 }}>{data.length} buildings</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {data.reduce((s, b) => s + b.count, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Footer tools ── */}
      <div className="rp-footer">
        <button
          className="rp-tool-btn"
          onClick={onBuildingNames}
        >
          Building names
        </button>
        <button
          className={`rp-tool-btn${showPanel === 'freq' ? ' active' : ''}`}
          onClick={() => setShowPanel((v) => v === 'freq' ? 'none' : 'freq')}
        >
          Building frequency
        </button>
        <button className="rp-tool-btn" onClick={onMapOverview}>
          Map overview
        </button>
        <button className="rp-tool-btn" onClick={onExport}>
          Export CSV {'↓'}
        </button>
      </div>
    </aside>
  );
}
