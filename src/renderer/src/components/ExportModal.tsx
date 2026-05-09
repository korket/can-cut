import { useState, useEffect } from 'react'
import { useEditorStore } from '../store/useEditorStore'

interface Props {
  onClose: () => void
}

export default function ExportModal({ onClose }: Props) {
  const { clips, timelineItems, textOverlays } = useEditorStore()
  const [resolution, setResolution] = useState('1920x1080')
  const [fps, setFps] = useState(30)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ success?: boolean; path?: string; error?: string } | null>(null)

  useEffect(() => {
    const unsub = window.api.onExportProgress((pct) => setProgress(Math.round(pct)))
    return unsub
  }, [])

  async function handleExport() {
    if (timelineItems.length === 0) return
    setExporting(true)
    setProgress(0)
    setResult(null)

    const exportClips = timelineItems
      .sort((a, b) => a.startTime - b.startTime)
      .map((item) => {
        const clip = clips.find((c) => c.id === item.clipId)!
        return { path: clip.path, trimStart: item.trimStart, trimEnd: item.trimEnd, type: clip.type }
      })
      .filter((c) => c.path)

    const exportOverlays = textOverlays.map((o) => ({
      text: o.text,
      color: o.color,
      fontSize: o.fontSize,
      x: o.x,
      y: o.y,
      startTime: o.startTime,
      endTime: o.endTime
    }))

    try {
      const res = await window.api.exportVideo({ clips: exportClips, textOverlays: exportOverlays, resolution, fps })
      if (res?.canceled) { setExporting(false); return }
      setResult(res)
    } catch (e: any) {
      setResult({ error: String(e) })
    }
    setExporting(false)
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Export Video</span>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {!result && (
          <>
            <div style={styles.field}>
              <label style={styles.label}>Resolution</label>
              <select style={styles.select} value={resolution} onChange={(e) => setResolution(e.target.value)}>
                <option value="3840x2160">4K (3840×2160)</option>
                <option value="1920x1080">1080p (1920×1080)</option>
                <option value="1280x720">720p (1280×720)</option>
                <option value="854x480">480p (854×480)</option>
              </select>
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Frame Rate</label>
              <select style={styles.select} value={fps} onChange={(e) => setFps(+e.target.value)}>
                <option value={60}>60 fps</option>
                <option value={30}>30 fps</option>
                <option value={24}>24 fps</option>
              </select>
            </div>

            {exporting ? (
              <div style={styles.progressWrap}>
                <div style={styles.progressBar}>
                  <div style={{ ...styles.progressFill, width: `${progress}%` }} />
                </div>
                <span style={styles.progressLabel}>{progress}%</span>
              </div>
            ) : (
              <button style={styles.exportBtn} onClick={handleExport} disabled={timelineItems.length === 0}>
                {timelineItems.length === 0 ? 'No clips on timeline' : 'Export MP4'}
              </button>
            )}
          </>
        )}

        {result?.success && (
          <div style={styles.success}>
            <div style={styles.successIcon}>✓</div>
            <div style={styles.successText}>Export complete!</div>
            <div style={styles.successPath}>{result.path}</div>
            <button style={styles.openBtn} onClick={() => window.api.openPath(result.path!)}>Open File</button>
            <button style={styles.doneBtn} onClick={onClose}>Done</button>
          </div>
        )}

        {result?.error && (
          <div style={styles.error}>
            <div style={styles.errorText}>Export failed</div>
            <div style={styles.errorDetail}>{result.error}</div>
            <button style={styles.retryBtn} onClick={() => setResult(null)}>Retry</button>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 12, padding: 28, width: 440, display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: 700, color: '#fff' },
  closeBtn: { background: 'none', border: 'none', color: '#888', fontSize: 24, cursor: 'pointer' },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 14, color: '#aaa' },
  select: { background: '#2a2a2a', border: '1px solid #444', color: '#fff', padding: '8px 12px', borderRadius: 7, fontSize: 14 },
  exportBtn: { background: '#e63950', border: 'none', color: '#fff', padding: '12px', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 700 },
  progressWrap: { display: 'flex', alignItems: 'center', gap: 12 },
  progressBar: { flex: 1, height: 10, background: '#333', borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#e63950', transition: 'width 0.2s' },
  progressLabel: { fontSize: 14, color: '#aaa', minWidth: 36 },
  success: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  successIcon: { fontSize: 48, color: '#2abf5a' },
  successText: { fontSize: 18, fontWeight: 600, color: '#fff' },
  successPath: { fontSize: 12, color: '#666', wordBreak: 'break-all', textAlign: 'center' },
  openBtn: { background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '8px 20px', borderRadius: 7, cursor: 'pointer', fontSize: 14 },
  doneBtn: { background: '#e63950', border: 'none', color: '#fff', padding: '8px 24px', borderRadius: 7, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  error: { display: 'flex', flexDirection: 'column', gap: 10 },
  errorText: { fontSize: 16, color: '#f66', fontWeight: 600 },
  errorDetail: { fontSize: 13, color: '#888', wordBreak: 'break-all' },
  retryBtn: { background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '7px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13, alignSelf: 'flex-start' }
}
