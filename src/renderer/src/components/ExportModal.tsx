import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_EXPORT_PROFILE,
  EXPORT_PROFILES,
  VIDEO_ENCODERS,
  getExportProfile,
  getVideoEncoderOption,
  withVideoCodec,
  type ExportProfileId,
  type ExportVideoCodec,
} from '../editor-core/exportSettings'
import { buildExportPreflight } from '../editor-core/exportPreflight'
import { createRenderPlan } from '../editor-core/renderPlan'
import { isTerminalExportStatus } from '../media-engine/exportJob'
import { exportJobManager, type ExportJobSnapshot } from '../media-engine/exportJobManager'
import { useEditorStore } from '../store/useEditorStore'

interface Props {
  onClose: () => void
}

function jobStatusLabel(job: ExportJobSnapshot | null) {
  if (!job) return 'Ready'
  if (job.status === 'queued') return 'Queued'
  if (job.status === 'canceling') return 'Canceling'
  if (job.status === 'completed') return 'Done'
  if (job.status === 'failed') return 'Failed'
  if (job.status === 'canceled') return 'Canceled'
  if (job.status === 'interrupted') return 'Interrupted'
  return job.mode === 'native' ? 'Fast' : 'Render'
}

function jobTitle(job: ExportJobSnapshot) {
  return `${job.plan.resolution.width}x${job.plan.resolution.height} MP4`
}

function formatDuration(ms: number | undefined) {
  if (ms == null) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatBytes(bytes: number | undefined) {
  if (bytes == null) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function ExportModal({ onClose }: Props) {
  const { clips, timelineItems, textOverlays, getTimelineDuration } = useEditorStore()
  const [resolution, setResolution] = useState('1920x1080')
  const [fps, setFps] = useState(30)
  const [profileId, setProfileId] = useState<ExportProfileId>(DEFAULT_EXPORT_PROFILE.id)
  const [videoCodec, setVideoCodec] = useState<ExportVideoCodec>('libx264')
  const [availableVideoEncoders, setAvailableVideoEncoders] = useState<string[] | null>(null)
  const [jobs, setJobs] = useState<ExportJobSnapshot[]>(() => exportJobManager.getJobs())
  const [selectedJobId, setSelectedJobId] = useState<string | null>(() => exportJobManager.getLatestActiveJob()?.id ?? null)
  const [startError, setStartError] = useState<string | null>(null)

  const selectedJob = selectedJobId ? jobs.find((job) => job.id === selectedJobId) ?? null : null
  const selectedProfile = useMemo(
    () => withVideoCodec(getExportProfile(profileId), videoCodec),
    [profileId, videoCodec]
  )
  const selectedVideoEncoder = getVideoEncoderOption(selectedProfile.encoder.videoCodec)
  const videoEncoderOptions = useMemo(() => {
    if (!availableVideoEncoders) return VIDEO_ENCODERS
    const available = new Set(availableVideoEncoders)
    return VIDEO_ENCODERS.filter((encoder) => encoder.codec === 'libx264' || available.has(encoder.codec))
  }, [availableVideoEncoders])
  const hasHardwareEncoderOption = videoEncoderOptions.some((encoder) => encoder.codec !== 'libx264')
  const currentRenderPlan = useMemo(
    () => createRenderPlan({ resolution, fps, duration: getTimelineDuration(), timelineItems, clips, textOverlays }),
    [resolution, fps, getTimelineDuration, timelineItems, clips, textOverlays]
  )
  const currentPreflight = useMemo(
    () => buildExportPreflight(currentRenderPlan, selectedProfile),
    [currentRenderPlan, selectedProfile]
  )
  const selectedResult = selectedJob?.result && !selectedJob.result.canceled ? selectedJob.result : null
  const selectedTrace = selectedResult?.trace
  const selectedLogs = selectedJob?.logs.slice(-8) ?? []
  const selectedIssues = selectedJob?.validation?.issues ?? []
  const selectedTiming = selectedJob?.timing
  const selectedJobActive = selectedJob ? !isTerminalExportStatus(selectedJob.status) : false
  const hasActiveJob = jobs.some((job) => !isTerminalExportStatus(job.status))
  const backendDetail = currentPreflight.backend === 'ffmpeg-native'
    ? 'Fast path: FFmpeg renders supported edits directly and avoids canvas frame transfer.'
    : currentPreflight.backendReason ?? 'Canvas fallback: timeline requires renderer-only features.'

  useEffect(() => {
    function syncJobs() {
      setJobs(exportJobManager.getJobs())
    }

    syncJobs()
    return exportJobManager.subscribe(syncJobs)
  }, [])

  useEffect(() => {
    let canceled = false
    window.api.listVideoEncoders()
      .then((encoders) => { if (!canceled) setAvailableVideoEncoders(encoders) })
      .catch(() => { if (!canceled) setAvailableVideoEncoders([]) })
    return () => { canceled = true }
  }, [])

  useEffect(() => {
    if (videoEncoderOptions.some((encoder) => encoder.codec === videoCodec)) return
    setVideoCodec('libx264')
  }, [videoEncoderOptions, videoCodec])

  useEffect(() => {
    if (selectedJobId && jobs.some((job) => job.id === selectedJobId)) return
    setSelectedJobId(exportJobManager.getLatestActiveJob()?.id ?? jobs[0]?.id ?? null)
  }, [jobs, selectedJobId])

  async function handleExport() {
    if (timelineItems.length === 0) return

    setStartError(null)
    const job = await exportJobManager.start(currentRenderPlan, selectedProfile)
    if (!job) {
      setStartError(exportJobManager.getLastStartError())
      return
    }
    setSelectedJobId(job.id)
  }

  async function handleCancel(jobId: string) {
    await exportJobManager.cancel(jobId)
  }

  function handleClear(jobId: string) {
    exportJobManager.remove(jobId)
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Export Video</span>
          <button style={styles.closeBtn} onClick={onClose}>Close</button>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Resolution</label>
          <select style={styles.select} value={resolution} onChange={(e) => setResolution(e.target.value)}>
            <option value="3840x2160">4K (3840x2160)</option>
            <option value="1920x1080">1080p (1920x1080)</option>
            <option value="1280x720">720p (1280x720)</option>
            <option value="854x480">480p (854x480)</option>
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

        <div style={styles.field}>
          <label style={styles.label}>Profile</label>
          <select style={styles.select} value={profileId} onChange={(e) => setProfileId(e.target.value as ExportProfileId)}>
            {EXPORT_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.label} - {profile.description}</option>
            ))}
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>Encoder</label>
          <select style={styles.select} value={videoCodec} onChange={(e) => setVideoCodec(e.target.value as ExportVideoCodec)}>
            {videoEncoderOptions.map((encoder) => (
              <option key={encoder.codec} value={encoder.codec}>{encoder.label} - {encoder.description}</option>
            ))}
          </select>
          <div style={styles.helpText}>
            {availableVideoEncoders && !hasHardwareEncoderOption
              ? 'Bundled FFmpeg did not report hardware H.264 encoders on this system.'
              : selectedVideoEncoder.description}
          </div>
        </div>

        <button style={styles.exportBtn} onClick={handleExport} disabled={timelineItems.length === 0}>
          {timelineItems.length === 0 ? 'No clips on timeline' : hasActiveJob ? 'Queue Export' : 'Export MP4'}
        </button>
        {startError && (
          <div style={styles.issueError}>{startError}</div>
        )}

        <div style={styles.preflight}>
          <div style={styles.preflightRow}>
            <span style={styles.preflightLabel}>Backend</span>
            <span style={styles.preflightValue}>{currentPreflight.backend === 'ffmpeg-native' ? 'Fast native FFmpeg' : 'Canvas render'}</span>
          </div>
          <div style={styles.preflightDetail}>{backendDetail}</div>
          <div style={styles.preflightRow}>
            <span style={styles.preflightLabel}>Encoder</span>
            <span style={styles.preflightValue}>{selectedVideoEncoder.label}</span>
          </div>
          <div style={styles.preflightRow}>
            <span style={styles.preflightLabel}>Frames</span>
            <span style={styles.preflightValue}>{currentPreflight.frameCount.toLocaleString()} at {currentPreflight.fps} fps</span>
          </div>
          <div style={styles.preflightRow}>
            <span style={styles.preflightLabel}>Layers</span>
            <span style={styles.preflightValue}>{currentPreflight.videoLayerCount} video, {currentPreflight.audioLayerCount} audio, {currentPreflight.textLayerCount} text</span>
          </div>
          <div style={styles.preflightRow}>
            <span style={styles.preflightLabel}>Frame Pipe</span>
            <span style={styles.preflightValue}>{currentPreflight.backend === 'ffmpeg-native' ? 'Not used' : currentPreflight.framePipeFormat === 'raw-rgba' ? 'Raw RGBA' : 'MJPEG'}</span>
          </div>
          {currentPreflight.warnings.length > 0 && (
            <div style={styles.warningList}>
              {currentPreflight.warnings.map((warning) => (
                <div key={warning.code} style={styles.warningLine}>{warning.message}</div>
              ))}
            </div>
          )}
        </div>

        {selectedJobActive && selectedJob && (
          <div style={styles.progressWrap}>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${selectedJob.progress}%` }} />
            </div>
            <span style={styles.progressLabel}>{selectedJob.progress}%</span>
            <span style={styles.modeLabel}>{jobStatusLabel(selectedJob)}</span>
            <button style={styles.cancelBtn} onClick={() => handleCancel(selectedJob.id)}>Cancel</button>
          </div>
        )}

        {selectedResult?.success && (
          <div style={styles.success}>
            <div style={styles.successText}>Export complete</div>
            <div style={styles.successPath}>{selectedResult.path}</div>
            <button style={styles.openBtn} onClick={() => window.api.openPath(selectedResult.path!)}>Open File</button>
          </div>
        )}

        {selectedResult?.error && (
          <div style={styles.error}>
            <div style={styles.errorText}>Export failed</div>
            <div style={styles.errorDetail}>{selectedResult.error}</div>
            {selectedIssues.length > 0 && (
              <div style={styles.issueList}>
                {selectedIssues.map((issue) => (
                  <div key={`${issue.code}-${issue.layerId ?? issue.path ?? issue.message}`} style={issue.severity === 'error' ? styles.issueError : styles.issueWarning}>
                    {issue.message}
                  </div>
                ))}
              </div>
            )}
            {selectedLogs.length > 0 && (
              <div style={styles.logBox}>
                {selectedLogs.map((entry) => (
                  <div key={`${entry.at}-${entry.message}`} style={styles.logLine}>{entry.message}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedJob && selectedTiming && (
          <div style={styles.exportStats}>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Queue Wait</span>
              <span style={styles.preflightValue}>{formatDuration(selectedTiming.queueWaitMs)}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Validation</span>
              <span style={styles.preflightValue}>{formatDuration(selectedTiming.validationMs)}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Export Time</span>
              <span style={styles.preflightValue}>{formatDuration(selectedTiming.exportMs)}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Throughput</span>
              <span style={styles.preflightValue}>{selectedTiming.effectiveFps ? `${selectedTiming.effectiveFps.toFixed(1)} fps` : '-'}</span>
            </div>
          </div>
        )}

        {selectedTrace && (
          <div style={styles.exportStats}>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Plan Hash</span>
              <span style={styles.preflightValue}>{selectedTrace.planHash ?? '-'}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Cache Key</span>
              <span style={styles.preflightValue}>{selectedTrace.cacheKey ?? '-'}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Media Load</span>
              <span style={styles.preflightValue}>{formatDuration(selectedTrace.mediaLoadMs)}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Frame Render</span>
              <span style={styles.preflightValue}>{formatDuration(selectedTrace.frameRenderMs)}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Readback / Encode</span>
              <span style={styles.preflightValue}>{formatDuration(selectedTrace.frameReadbackMs)}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>IPC / Pipe Transfer</span>
              <span style={styles.preflightValue}>{formatDuration(selectedTrace.frameTransferMs)}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Encoder Finalize</span>
              <span style={styles.preflightValue}>{formatDuration(selectedTrace.encoderFinalizeMs)}</span>
            </div>
            <div style={styles.preflightRow}>
              <span style={styles.preflightLabel}>Frame Data</span>
              <span style={styles.preflightValue}>{selectedTrace.frameCount ?? '-'} frames | {formatBytes(selectedTrace.frameBytes)}</span>
            </div>
          </div>
        )}

        {jobs.length > 0 && (
          <div style={styles.jobList}>
            {jobs.map((job) => {
              const selected = selectedJobId === job.id
              const terminal = isTerminalExportStatus(job.status)
              const outputPath = job.result?.path

              return (
                <div
                  key={job.id}
                  role="button"
                  tabIndex={0}
                  style={{ ...styles.jobRow, ...(selected ? styles.jobRowActive : null) }}
                  onClick={() => setSelectedJobId(job.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setSelectedJobId(job.id)
                  }}
                >
                  <div style={styles.jobMain}>
                    <span style={styles.jobName}>{jobTitle(job)}</span>
                    <span style={styles.jobMeta}>{jobStatusLabel(job)} | {job.profile.label} | {getVideoEncoderOption(job.profile.encoder.videoCodec).label} | {job.preflight.frameCount.toLocaleString()} frames | {job.mode === 'native' ? 'fast path' : 'canvas render'}</span>
                  </div>

                  <div style={styles.jobProgress}>
                    <div style={styles.jobProgressBar}>
                      <div style={{ ...styles.progressFill, width: `${job.progress}%` }} />
                    </div>
                    <span style={styles.jobPct}>{job.progress}%</span>
                  </div>

                  {!terminal && (
                    <span
                      style={styles.jobAction}
                      onClick={(e) => { e.stopPropagation(); handleCancel(job.id) }}
                    >
                      Cancel
                    </span>
                  )}

                  {terminal && outputPath && (
                    <span
                      style={styles.jobAction}
                      onClick={(e) => { e.stopPropagation(); window.api.openPath(outputPath) }}
                    >
                      Open
                    </span>
                  )}

                  {terminal && (
                    <span
                      style={styles.jobAction}
                      onClick={(e) => { e.stopPropagation(); handleClear(job.id) }}
                    >
                      Clear
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 12, padding: 28, width: 520, maxHeight: '86vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 20 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: 700, color: '#fff' },
  closeBtn: { background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  field: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 14, color: '#aaa' },
  select: { background: '#2a2a2a', border: '1px solid #444', color: '#fff', padding: '8px 12px', borderRadius: 7, fontSize: 14 },
  helpText: { fontSize: 12, color: '#777', lineHeight: 1.4 },
  exportBtn: { background: '#e63950', border: 'none', color: '#fff', padding: '12px', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 700 },
  preflight: { display: 'flex', flexDirection: 'column', gap: 8, background: '#181818', border: '1px solid #333', borderRadius: 7, padding: 12 },
  preflightRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  preflightDetail: { fontSize: 12, color: '#888', lineHeight: 1.4, borderTop: '1px solid #2a2a2a', paddingTop: 8, marginTop: 2 },
  preflightLabel: { fontSize: 12, color: '#777' },
  preflightValue: { fontSize: 12, color: '#ddd', textAlign: 'right' },
  warningList: { display: 'flex', flexDirection: 'column', gap: 5, borderTop: '1px solid #2a2a2a', paddingTop: 8 },
  warningLine: { fontSize: 12, color: '#d6a24a' },
  progressWrap: { display: 'flex', alignItems: 'center', gap: 12 },
  progressBar: { flex: 1, height: 10, background: '#333', borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', background: '#e63950', transition: 'width 0.2s' },
  progressLabel: { fontSize: 14, color: '#aaa', minWidth: 36 },
  modeLabel: { fontSize: 11, color: '#666', textTransform: 'uppercase', minWidth: 56 },
  cancelBtn: { background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  success: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  successText: { fontSize: 18, fontWeight: 600, color: '#fff' },
  successPath: { fontSize: 12, color: '#666', wordBreak: 'break-all', textAlign: 'center' },
  openBtn: { background: '#2a2a2a', border: '1px solid #444', color: '#ccc', padding: '8px 20px', borderRadius: 7, cursor: 'pointer', fontSize: 14 },
  error: { display: 'flex', flexDirection: 'column', gap: 10 },
  errorText: { fontSize: 16, color: '#f66', fontWeight: 600 },
  errorDetail: { fontSize: 13, color: '#888', wordBreak: 'break-all' },
  logBox: { maxHeight: 140, overflow: 'auto', background: '#151515', border: '1px solid #333', borderRadius: 6, padding: 8 },
  logLine: { fontSize: 11, color: '#777', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  issueList: { display: 'flex', flexDirection: 'column', gap: 6 },
  issueError: { fontSize: 12, color: '#ff8a8a', background: '#241818', border: '1px solid #4a2424', borderRadius: 5, padding: 7 },
  issueWarning: { fontSize: 12, color: '#d6a24a', background: '#241f16', border: '1px solid #46381e', borderRadius: 5, padding: 7 },
  exportStats: { display: 'flex', flexDirection: 'column', gap: 8, background: '#181818', border: '1px solid #333', borderRadius: 7, padding: 12 },
  jobList: { display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #333', paddingTop: 14 },
  jobRow: { display: 'grid', gridTemplateColumns: '1fr 130px auto auto', alignItems: 'center', gap: 10, background: '#242424', border: '1px solid #333', color: '#ddd', borderRadius: 7, padding: 10, cursor: 'pointer', textAlign: 'left' },
  jobRowActive: { borderColor: '#e63950', background: '#2a2426' },
  jobMain: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  jobName: { fontSize: 13, color: '#fff', fontWeight: 600 },
  jobMeta: { fontSize: 11, color: '#888', textTransform: 'capitalize' },
  jobProgress: { display: 'flex', alignItems: 'center', gap: 8 },
  jobProgressBar: { width: 76, height: 6, background: '#333', borderRadius: 4, overflow: 'hidden' },
  jobPct: { fontSize: 11, color: '#888', minWidth: 30, textAlign: 'right' },
  jobAction: { fontSize: 12, color: '#ccc', padding: '5px 7px', border: '1px solid #444', borderRadius: 5, background: '#2a2a2a' },
}
