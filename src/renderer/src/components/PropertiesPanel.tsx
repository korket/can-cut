import { useState, useRef, useEffect } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import type { TextOverlay, Transform, Effects, Animation, AnimEffect, Transition, TransitionType, KeyframeTrack, KenBurns, CompositeMode } from '../types'
import { DEFAULT_TRANSFORM, DEFAULT_EFFECTS, DEFAULT_ANIMATION, DEFAULT_TRANSITION, DEFAULT_KEN_BURNS } from '../types'
import { nanoid } from '../utils/nanoid'
import { hasKeyframeAt, applyKeyframesToTransform, applyKeyframesToEffects } from '../utils/keyframes'

function selectOnFocus(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.select()
}

export default function PropertiesPanel() {
  const {
    selectedId, setSelectedId, timelineItems, textOverlays,
    updateTimelineItem, updateTransform, updateEffects, updateAnimation, updateTransition,
    addKeyframe, removeKeyframe,
    updateTextOverlay, removeTextOverlay,
    clips, currentTime, addTextOverlay, tool, videoTrackCount,
    defaultTransformEnabled, defaultTransform, setDefaultTransformEnabled, setDefaultTransform, captureDefaultTransform,
  } = useEditorStore()

  const [activeTab, setActiveTab] = useState('transform')

  const selectedItem    = timelineItems.find(i => i.id === selectedId)
  const selectedOverlay = textOverlays.find(o => o.id === selectedId)
  const selectedClip    = selectedItem ? clips.find(c => c.id === selectedItem.clipId) : null

  const prevItem = selectedItem ? timelineItems.find(i =>
    i.trackIndex === selectedItem.trackIndex && i.id !== selectedItem.id &&
    Math.abs((i.startTime + (i.trimEnd - i.trimStart)) - selectedItem.startTime) < 500
  ) : null

  const isTextSelection = !!selectedOverlay
  const clipTime = selectedItem
    ? Math.max(0, currentTime - selectedItem.startTime)
    : selectedOverlay
      ? Math.max(0, currentTime - selectedOverlay.startTime)
      : 0
  const selectedDuration = selectedItem
    ? selectedItem.trimEnd - selectedItem.trimStart
    : selectedOverlay
      ? selectedOverlay.endTime - selectedOverlay.startTime
      : 0
  const kfTracks = selectedItem?.keyframeTracks ?? selectedOverlay?.keyframeTracks ?? []
  const selectedEditableId = selectedItem?.id ?? selectedOverlay?.id ?? null
  const addKf    = (property: string, value: number) => { if (selectedEditableId) addKeyframe(selectedEditableId, property, clipTime, value) }
  const removeKf = (property: string) => { if (selectedEditableId) removeKeyframe(selectedEditableId, property, clipTime) }

  function addText() {
    const id = nanoid()
    addTextOverlay({
      id, text: 'Sample Text', fontFamily: 'sans-serif',
      fontSize: 36, color: '#ffffff', x: 100, y: 80,
      trackIndex: Math.max(0, videoTrackCount - 1),
      startTime: currentTime, endTime: currentTime + 3000,
      bold: false, italic: false,
      transform: { ...DEFAULT_TRANSFORM },
      effects: { ...DEFAULT_EFFECTS },
      animation: { ...DEFAULT_ANIMATION },
    })
    setSelectedId(id)
  }

  const canCapture = !!(selectedItem && selectedClip && selectedClip.type !== 'audio')

  // Build tab list based on selected clip type
  const tabs: { id: string; label: string }[] = []
  if (selectedOverlay) {
    tabs.push(
      { id: 'text',       label: 'Text'       },
      { id: 'transform',  label: 'Transform'  },
      { id: 'animation',  label: 'Animation'  },
      { id: 'effects',    label: 'FX'         },
      { id: 'clip',       label: 'Clip'       },
    )
  } else if (selectedItem && selectedClip) {
    if (selectedClip.type !== 'image') tabs.push({ id: 'audio',      label: 'Audio'      })
    if (selectedClip.type !== 'audio') {
      tabs.push(
        { id: 'transform',  label: 'Transform'  },
        { id: 'animation',  label: 'Animation'  },
      )
      if (prevItem) tabs.push({ id: 'transition', label: 'Transition' })
      tabs.push({ id: 'effects', label: 'FX' })
    }
    tabs.push({ id: 'clip', label: 'Clip' })
  }

  // Fall back to first available tab if current tab doesn't exist for this clip
  const tab = tabs.find(t => t.id === activeTab) ? activeTab : (tabs[0]?.id ?? '')

  const baseT = selectedItem
    ? { ...DEFAULT_TRANSFORM, ...selectedItem.transform }
    : selectedOverlay
      ? { ...DEFAULT_TRANSFORM, ...selectedOverlay.transform }
      : DEFAULT_TRANSFORM
  const baseE = selectedItem
    ? { ...DEFAULT_EFFECTS, ...selectedItem.effects }
    : selectedOverlay
      ? { ...DEFAULT_EFFECTS, ...selectedOverlay.effects }
      : DEFAULT_EFFECTS
  const effT  = kfTracks.length > 0 ? applyKeyframesToTransform(kfTracks, baseT, clipTime) : baseT
  const effE  = kfTracks.length > 0 ? applyKeyframesToEffects(kfTracks, baseE, clipTime)   : baseE
  const updateTextTransform = (changes: Partial<Transform>) => {
    if (selectedOverlay) updateTextOverlay(selectedOverlay.id, { transform: { ...DEFAULT_TRANSFORM, ...selectedOverlay.transform, ...changes } })
  }
  const updateTextEffects = (changes: Partial<Effects>) => {
    if (selectedOverlay) updateTextOverlay(selectedOverlay.id, { effects: { ...DEFAULT_EFFECTS, ...selectedOverlay.effects, ...changes } })
  }
  const updateTextAnimation = (changes: Partial<Animation>) => {
    if (selectedOverlay) updateTextOverlay(selectedOverlay.id, { animation: { ...DEFAULT_ANIMATION, ...selectedOverlay.animation, ...changes } })
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>Properties</div>

      {tool === 'text' && (
        <div style={{ padding: '10px 14px', flexShrink: 0 }}>
          <button style={styles.addTextBtn} onClick={addText}>+ Add Text</button>
        </div>
      )}

      {tabs.length > 0 && (
        <>
          {/* Tab bar */}
          <div style={styles.tabBar}>
            {tabs.map(t => (
              <button
                key={t.id}
                style={{ ...styles.tabBtn, ...(tab === t.id ? styles.tabBtnActive : {}) }}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content — scrollable */}
          <div style={styles.tabContent}>
            {tab === 'text' && selectedOverlay && (
              <TextProps
                overlay={selectedOverlay}
                update={c => updateTextOverlay(selectedOverlay.id, c)}
              />
            )}

            {tab === 'audio' && selectedItem && (
              <AudioSection
                volume={selectedItem.volume ?? 100}
                update={v => updateTimelineItem(selectedItem.id, { volume: v })}
                flat
              />
            )}

            {tab === 'transform' && (selectedItem || selectedOverlay) && (
              <>
                <TransformSection
                  transform={baseT} effective={effT}
                  update={c => selectedItem ? updateTransform(selectedItem.id, c) : updateTextTransform(c)}
                  clipTime={clipTime} kfTracks={kfTracks}
                  addKf={addKf} removeKf={removeKf}
                  flat
                />
                {selectedItem && (
                  <div style={{ borderTop: '1px solid #222' }}>
                    <CropSection
                      transform={baseT}
                      update={c => updateTransform(selectedItem.id, c)}
                    />
                  </div>
                )}
              </>
            )}

            {tab === 'animation' && (selectedItem || selectedOverlay) && (
              <>
                <AnimationSection
                  animation={{ ...DEFAULT_ANIMATION, ...(selectedItem ? selectedItem.animation : selectedOverlay?.animation) }}
                  clipDuration={selectedDuration}
                  update={c => selectedItem ? updateAnimation(selectedItem.id, c) : updateTextAnimation(c)}
                  flat
                />
                {selectedClip && selectedClip.type !== 'audio' && (
                  <KenBurnsSection
                    kenBurns={selectedItem.kenBurns}
                    update={kb => updateTimelineItem(selectedItem.id, { kenBurns: kb })}
                    clipDurationMs={selectedItem.trimEnd - selectedItem.trimStart}
                  />
                )}
              </>
            )}

            {tab === 'effects' && (selectedItem || selectedOverlay) && (
              <EffectsSection
                effects={baseE} effective={effE}
                update={c => selectedItem ? updateEffects(selectedItem.id, c) : updateTextEffects(c)}
                clipTime={clipTime} kfTracks={kfTracks}
                addKf={addKf} removeKf={removeKf}
                flat
              />
            )}

            {tab === 'transition' && selectedItem && prevItem && (
              <TransitionSection
                transition={{ ...DEFAULT_TRANSITION, ...selectedItem.transitionIn }}
                update={c => updateTransition(selectedItem.id, c)}
                flat
              />
            )}

            {tab === 'clip' && selectedOverlay && (
              <TextClipProps
                overlay={selectedOverlay}
                update={c => updateTextOverlay(selectedOverlay.id, c)}
                onDelete={() => removeTextOverlay(selectedOverlay.id)}
              />
            )}

            {tab === 'clip' && selectedItem && selectedClip && (
              <ClipProps
                item={selectedItem}
                clip={selectedClip}
                update={c => updateTimelineItem(selectedItem.id, c)}
              />
            )}
          </div>
        </>
      )}

      {!selectedOverlay && !selectedItem && tool !== 'text' && (
        <div style={styles.empty}>Select a clip to edit its properties</div>
      )}

      {!isTextSelection && (
        <DefaultTransformSection
          enabled={defaultTransformEnabled}
          transform={defaultTransform}
          onToggle={() => setDefaultTransformEnabled(!defaultTransformEnabled)}
          onCapture={canCapture ? () => captureDefaultTransform({ ...DEFAULT_TRANSFORM, ...selectedItem!.transform }) : undefined}
          update={setDefaultTransform}
        />
      )}
    </div>
  )
}

// ── Chain link icon ───────────────────────────────────────────────────────────
function ChainIcon({ linked }: { linked: boolean }) {
  const c = linked ? '#2abf5a' : '#444'
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" style={{ display: 'block' }}>
      <rect x="0.7" y="2.2" width="5" height="5.6" rx="2" fill="none" stroke={c} strokeWidth="1.3"/>
      <rect x="8.3" y="2.2" width="5" height="5.6" rx="2" fill="none" stroke={c} strokeWidth="1.3"/>
      {linked
        ? <line x1="5.7" y1="5" x2="8.3" y2="5" stroke={c} strokeWidth="1.3"/>
        : <><line x1="5.7" y1="5" x2="6.5" y2="5" stroke={c} strokeWidth="1.3"/><line x1="7.5" y1="5" x2="8.3" y2="5" stroke={c} strokeWidth="1.3"/></>
      }
    </svg>
  )
}

// ── Default Transform Section ─────────────────────────────────────────────────
function DefaultTransformSection({ enabled, transform: t, onToggle, onCapture, update }: {
  enabled: boolean
  transform: Transform
  onToggle: () => void
  onCapture?: () => void
  update: (c: Partial<Transform>) => void
}) {
  const [open, setOpen] = useState(false)
  const [scaleLinked, setScaleLinked] = useState(true)

  function onScaleX(v: number) { update(scaleLinked ? { scaleX: v / 100, scaleY: v / 100 } : { scaleX: v / 100 }) }
  function onScaleY(v: number) { update(scaleLinked ? { scaleX: v / 100, scaleY: v / 100 } : { scaleY: v / 100 }) }

  return (
    <div style={{ borderTop: '1px solid #252525', flexShrink: 0 }}>
      <div style={styles.sectionRow} onClick={() => setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...styles.sectionTitle, color: enabled ? '#2abf5a' : undefined }}>Default Transform</span>
          {enabled && <span style={{ fontSize: 10, color: '#2abf5a', background: 'rgba(42,191,90,0.12)', padding: '1px 5px', borderRadius: 3 }}>ON</span>}
        </div>
        <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div style={styles.transformGrid}>
          <button
            style={{ gridColumn: 'span 2', background: enabled ? 'rgba(42,191,90,0.15)' : '#222', border: `1px solid ${enabled ? '#2abf5a' : '#333'}`, color: enabled ? '#2abf5a' : '#888', padding: '6px 0', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            onClick={onToggle}
          >
            {enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
          </button>

          <div style={{ gridColumn: 'span 2', display: 'flex', gap: 8 }}>
            <button
              style={{ flex: 1, background: onCapture ? '#1a2a1a' : '#1a1a1a', border: `1px solid ${onCapture ? '#2a5a2a' : '#2a2a2a'}`, color: onCapture ? '#6cf87c' : '#444', padding: '5px 0', borderRadius: 5, cursor: onCapture ? 'pointer' : 'default', fontSize: 12 }}
              onClick={onCapture}
              disabled={!onCapture}
              title={onCapture ? 'Copy selected clip\'s transform to default' : 'Select a video or image clip first'}
            >
              ⬇ Capture
            </button>
            <button
              style={{ background: '#1a1a1a', border: '1px solid #333', color: '#666', padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}
              onClick={() => update({ ...DEFAULT_TRANSFORM })}
              title="Reset to defaults"
            >
              Reset
            </button>
          </div>

          <ScalePair
            xVal={Math.round(t.scaleX * 100)} yVal={Math.round(t.scaleY * 100)} linked={scaleLinked}
            onXChange={onScaleX} onYChange={onScaleY}
            onXReset={() => update(scaleLinked ? { scaleX: 1, scaleY: 1 } : { scaleX: 1 })}
            onYReset={() => update(scaleLinked ? { scaleX: 1, scaleY: 1 } : { scaleY: 1 })}
            onToggleLink={() => setScaleLinked(l => !l)}
            kfX={{ active: false, toggle: () => {} }} kfY={{ active: false, toggle: () => {} }}
          />
          <TRow label="Pos X"    min={-200} max={200} step={0.5} value={+t.posX.toFixed(1)}          unit="%" onChange={v => update({ posX: v })}          onReset={() => update({ posX: 0 })}      speed={0.4} />
          <TRow label="Pos Y"    min={-200} max={200} step={0.5} value={+t.posY.toFixed(1)}          unit="%" onChange={v => update({ posY: v })}          onReset={() => update({ posY: 0 })}      speed={0.4} />
          <TRow label="Rotation" min={-180} max={180} step={0.5} value={+t.rotation.toFixed(1)}      unit="°" onChange={v => update({ rotation: v })}      onReset={() => update({ rotation: 0 })}  speed={0.4} wide />
          <TRow label="Anchor X" min={0}    max={100} step={1}   value={Math.round(t.anchorX * 100)} unit="%" onChange={v => update({ anchorX: v / 100 })} onReset={() => update({ anchorX: 0.5 })} />
          <TRow label="Anchor Y" min={0}    max={100} step={1}   value={Math.round(t.anchorY * 100)} unit="%" onChange={v => update({ anchorY: v / 100 })} onReset={() => update({ anchorY: 0.5 })} />
        </div>
      )}
    </div>
  )
}

// ── Audio Section ─────────────────────────────────────────────────────────────
function AudioSection({ volume, update, flat }: { volume: number; update: (v: number) => void; flat?: boolean }) {
  const [open, setOpen] = useState(true)
  const isModified = volume !== 100

  const grid = (
    <div style={styles.transformGrid}>
      <TRow label="Volume" min={0} max={200} step={1} value={volume} unit="%" onChange={update} onReset={() => update(100)} wide />
    </div>
  )

  if (flat) return grid

  return (
    <div style={styles.section}>
      <div style={styles.sectionRow} onClick={() => setOpen(o => !o)}>
        <span style={{ ...styles.sectionTitle, color: isModified ? '#e6a030' : undefined }}>Audio</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {isModified && <button style={styles.resetAllBtn} onClick={e => { e.stopPropagation(); update(100) }}>Reset</button>}
          <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
        </div>
      </div>
      {open && grid}
    </div>
  )
}

// ── Transition Section ────────────────────────────────────────────────────────
function TransitionSection({ transition: tr, update, flat }: { transition: Transition; update: (c: Partial<Transition>) => void; flat?: boolean }) {
  const [open, setOpen] = useState(true)
  const hasTransition = tr.type !== 'cut'

  const grid = (
    <div style={styles.transformGrid}>
      <div style={{ ...styles.animSelectRow, gridColumn: 'span 2' }}>
        <span style={styles.tLabel}>Type</span>
        <select value={tr.type} onChange={e => update({ type: e.target.value as TransitionType })} style={styles.animSelect}>
          <option value="cut">Cut (none)</option>
          <option value="crossfade">Crossfade</option>
          <option value="fade-color">Fade to Color</option>
          <option value="wipe-left">Wipe Left</option>
          <option value="wipe-right">Wipe Right</option>
          <option value="wipe-up">Wipe Up</option>
          <option value="wipe-down">Wipe Down</option>
        </select>
      </div>
      {tr.type !== 'cut' && (
        <TRow label="Duration" min={100} max={3000} step={50} value={tr.duration} unit="ms"
          onChange={v => update({ duration: v })} onReset={() => update({ duration: 500 })} wide />
      )}
      {tr.type === 'fade-color' && (
        <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={styles.tLabel}>Color</span>
          <input type="color" value={tr.color} onChange={e => update({ color: e.target.value })} style={styles.colorPicker} />
          <span style={{ fontSize: 12, color: '#888' }}>{tr.color}</span>
        </div>
      )}
    </div>
  )

  if (flat) return grid

  return (
    <div style={styles.section}>
      <div style={styles.sectionRow} onClick={() => setOpen(o => !o)}>
        <span style={{ ...styles.sectionTitle, color: hasTransition ? '#9060ff' : undefined }}>Transition In</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasTransition && <button style={styles.resetAllBtn} onClick={e => { e.stopPropagation(); update({ type: 'cut' }) }}>Reset</button>}
          <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
        </div>
      </div>
      {open && grid}
    </div>
  )
}

// ── Scale X/Y paired row with chain link ──────────────────────────────────────
function ScalePair({ xVal, yVal, linked, onXChange, onYChange, onXReset, onYReset, onToggleLink, kfX, kfY }: {
  xVal: number; yVal: number; linked: boolean
  onXChange: (v: number) => void; onYChange: (v: number) => void
  onXReset: () => void; onYReset: () => void
  onToggleLink: () => void
  kfX: { active: boolean; toggle: () => void }; kfY: { active: boolean; toggle: () => void }
}) {
  return (
    <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'flex-end', gap: 8 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <button style={{ ...styles.tKfBtn, color: kfX.active ? '#ffcc00' : '#333' }} onClick={kfX.toggle} title="Toggle keyframe">◆</button>
          <span style={styles.tCellLabel}>Scale X</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <DragNumber value={xVal} min={0} max={500} step={1} onChange={onXChange} />
          <span style={styles.tUnit}>%</span>
          <button style={styles.tReset} onClick={onXReset} title="Reset">↺</button>
        </div>
      </div>
      <button
        style={{ ...styles.chainBtn, ...(linked ? styles.chainBtnActive : {}) }}
        onClick={onToggleLink}
        title={linked ? 'Unlink' : 'Link scales'}
      >
        <ChainIcon linked={linked} />
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <button style={{ ...styles.tKfBtn, color: kfY.active ? '#ffcc00' : '#333' }} onClick={kfY.toggle} title="Toggle keyframe">◆</button>
          <span style={styles.tCellLabel}>Scale Y</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <DragNumber value={yVal} min={0} max={500} step={1} onChange={onYChange} />
          <span style={styles.tUnit}>%</span>
          <button style={styles.tReset} onClick={onYReset} title="Reset">↺</button>
        </div>
      </div>
    </div>
  )
}

// ── Transform Section ─────────────────────────────────────────────────────────
interface TransformSectionProps {
  transform: Transform; effective: Transform
  update: (c: Partial<Transform>) => void
  clipTime: number; kfTracks: KeyframeTrack[]
  addKf: (p: string, v: number) => void; removeKf: (p: string) => void
  flat?: boolean
}
function TransformSection({ transform: t, effective: e, update, clipTime, kfTracks, addKf, removeKf, flat }: TransformSectionProps) {
  const [open,        setOpen]        = useState(true)
  const [scaleLinked, setScaleLinked] = useState(true)

  const reset = () => update({ ...DEFAULT_TRANSFORM })

  function kf(prop: string, val: number) {
    const active = hasKeyframeAt(kfTracks, prop, clipTime)
    return { active, toggle: () => active ? removeKf(prop) : addKf(prop, val) }
  }
  function ch(prop: string, v: number, baseUpdate: () => void, extraKf?: [string, number]) {
    if (hasKeyframeAt(kfTracks, prop, clipTime)) addKf(prop, v)
    else baseUpdate()
    if (extraKf && hasKeyframeAt(kfTracks, extraKf[0], clipTime)) addKf(extraKf[0], extraKf[1])
  }

  const sxPct = Math.round(e.scaleX * 100)
  const syPct = Math.round(e.scaleY * 100)

  function onScaleX(v: number) {
    const sv = v / 100
    ch('scaleX', sv, () => update(scaleLinked ? { scaleX: sv, scaleY: sv } : { scaleX: sv }), scaleLinked ? ['scaleY', sv] : undefined)
  }
  function onScaleY(v: number) {
    const sv = v / 100
    ch('scaleY', sv, () => update(scaleLinked ? { scaleX: sv, scaleY: sv } : { scaleY: sv }), scaleLinked ? ['scaleX', sv] : undefined)
  }

  const grid = (
    <div style={styles.transformGrid}>
      <ScalePair
        xVal={sxPct} yVal={syPct} linked={scaleLinked}
        onXChange={onScaleX} onYChange={onScaleY}
        onXReset={() => update(scaleLinked ? { scaleX: 1, scaleY: 1 } : { scaleX: 1 })}
        onYReset={() => update(scaleLinked ? { scaleX: 1, scaleY: 1 } : { scaleY: 1 })}
        onToggleLink={() => setScaleLinked(l => !l)}
        kfX={kf('scaleX', e.scaleX)} kfY={kf('scaleY', e.scaleY)}
      />
      <TRow label="Pos X"    min={-200} max={200} step={0.5} value={+e.posX.toFixed(1)}        unit="%" onChange={v => ch('posX',     v, () => update({ posX: v }))}             onReset={() => update({ posX: 0 })}       kf={kf('posX',     e.posX)}     speed={0.4} />
      <TRow label="Pos Y"    min={-200} max={200} step={0.5} value={+e.posY.toFixed(1)}        unit="%" onChange={v => ch('posY',     v, () => update({ posY: v }))}             onReset={() => update({ posY: 0 })}       kf={kf('posY',     e.posY)}     speed={0.4} />
      <TRow label="Rotation" min={-180} max={180} step={0.5} value={+e.rotation.toFixed(1)}    unit="°" onChange={v => ch('rotation', v, () => update({ rotation: v }))}         onReset={() => update({ rotation: 0 })}   kf={kf('rotation', e.rotation)} speed={0.4} wide />
      <TRow label="Pitch"    min={-90}  max={90}  step={0.5} value={+e.pitch.toFixed(1)}       unit="°" onChange={v => ch('pitch',    v, () => update({ pitch: v }))}            onReset={() => update({ pitch: 0 })}      kf={kf('pitch',    e.pitch)} />
      <TRow label="Yaw"      min={-90}  max={90}  step={0.5} value={+e.yaw.toFixed(1)}         unit="°" onChange={v => ch('yaw',      v, () => update({ yaw: v }))}              onReset={() => update({ yaw: 0 })}        kf={kf('yaw',      e.yaw)} />
      <TRow label="Anchor X" min={0}    max={100} step={1}   value={Math.round(e.anchorX*100)} unit="%" onChange={v => ch('anchorX', v/100, () => update({ anchorX: v/100 }))}  onReset={() => update({ anchorX: 0.5 })}  kf={kf('anchorX',  e.anchorX)} />
      <TRow label="Anchor Y" min={0}    max={100} step={1}   value={Math.round(e.anchorY*100)} unit="%" onChange={v => ch('anchorY', v/100, () => update({ anchorY: v/100 }))}  onReset={() => update({ anchorY: 0.5 })}  kf={kf('anchorY',  e.anchorY)} />
      <div style={{ ...styles.flipRow, gridColumn: 'span 2' }}>
        <button style={{ ...styles.flipBtn, ...(t.flipH ? styles.flipBtnActive : {}) }} onClick={() => update({ flipH: !t.flipH })}>Flip H</button>
        <button style={{ ...styles.flipBtn, ...(t.flipV ? styles.flipBtnActive : {}) }} onClick={() => update({ flipV: !t.flipV })}>Flip V</button>
      </div>
      {flat && (
        <button style={{ gridColumn: 'span 2', ...styles.resetAllBtnFull }} onClick={reset}>Reset All</button>
      )}
    </div>
  )

  if (flat) return grid

  return (
    <div style={styles.section}>
      <div style={styles.sectionRow} onClick={() => setOpen(o => !o)}>
        <span style={styles.sectionTitle}>Transform</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={styles.resetAllBtn} onClick={ev => { ev.stopPropagation(); reset() }}>Reset</button>
          <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
        </div>
      </div>
      {open && grid}
    </div>
  )
}

// ── Crop Section ──────────────────────────────────────────────────────────────
function CropSection({ transform: t, update, flat }: { transform: Transform; update: (c: Partial<Transform>) => void; flat?: boolean }) {
  const [open, setOpen] = useState(true)

  const hasCrop = t.cropL > 0 || t.cropR > 0 || t.cropT > 0 || t.cropB > 0
  const reset = () => update({ cropL: 0, cropR: 0, cropT: 0, cropB: 0 })

  const grid = (
    <div style={styles.transformGrid}>
      <TRow label="Left"   min={0} max={99} step={0.5} value={+t.cropL.toFixed(1)} unit="%" onChange={v => update({ cropL: Math.min(v, 99 - t.cropR) })} onReset={() => update({ cropL: 0 })} />
      <TRow label="Right"  min={0} max={99} step={0.5} value={+t.cropR.toFixed(1)} unit="%" onChange={v => update({ cropR: Math.min(v, 99 - t.cropL) })} onReset={() => update({ cropR: 0 })} />
      <TRow label="Top"    min={0} max={99} step={0.5} value={+t.cropT.toFixed(1)} unit="%" onChange={v => update({ cropT: Math.min(v, 99 - t.cropB) })} onReset={() => update({ cropT: 0 })} />
      <TRow label="Bottom" min={0} max={99} step={0.5} value={+t.cropB.toFixed(1)} unit="%" onChange={v => update({ cropB: Math.min(v, 99 - t.cropT) })} onReset={() => update({ cropB: 0 })} />
      {flat && hasCrop && (
        <button style={{ gridColumn: 'span 2', ...styles.resetAllBtnFull }} onClick={reset}>Reset All</button>
      )}
    </div>
  )

  if (flat) return grid

  return (
    <div style={styles.section}>
      <div style={styles.sectionRow} onClick={() => setOpen(o => !o)}>
        <span style={{ ...styles.sectionTitle, color: hasCrop ? '#e6a030' : undefined }}>Crop</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasCrop && <button style={styles.resetAllBtn} onClick={e => { e.stopPropagation(); reset() }}>Reset</button>}
          <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
        </div>
      </div>
      {open && grid}
    </div>
  )
}

// ── Shadow presets ────────────────────────────────────────────────────────────
const SHADOW_PRESETS: Array<{ label: string; values?: { shadowOpacity: number; shadowBlur: number; shadowX: number; shadowY: number } }> = [
  { label: 'None' },
  { label: 'Soft',  values: { shadowOpacity: 55, shadowBlur: 16, shadowX: 0,  shadowY: 6  } },
  { label: 'Drop',  values: { shadowOpacity: 70, shadowBlur: 8,  shadowX: 4,  shadowY: 4  } },
  { label: 'Hard',  values: { shadowOpacity: 85, shadowBlur: 0,  shadowX: 4,  shadowY: 4  } },
  { label: 'Glow',  values: { shadowOpacity: 80, shadowBlur: 20, shadowX: 0,  shadowY: 0  } },
  { label: 'Deep',  values: { shadowOpacity: 75, shadowBlur: 18, shadowX: 8,  shadowY: 14 } },
]

const COMPOSITE_MODES: Array<{ value: CompositeMode; label: string }> = [
  { value: 'normal',      label: 'Normal'       },
  { value: 'multiply',    label: 'Multiply'     },
  { value: 'screen',      label: 'Screen'       },
  { value: 'overlay',     label: 'Overlay'      },
  { value: 'darken',      label: 'Darken'       },
  { value: 'lighten',     label: 'Lighten'      },
  { value: 'color-dodge', label: 'Color Dodge'  },
  { value: 'color-burn',  label: 'Color Burn'   },
  { value: 'hard-light',  label: 'Hard Light'   },
  { value: 'soft-light',  label: 'Soft Light'   },
  { value: 'difference',  label: 'Difference'   },
  { value: 'exclusion',   label: 'Exclusion'    },
  { value: 'hue',         label: 'Hue'          },
  { value: 'saturation',  label: 'Saturation'   },
  { value: 'color',       label: 'Color'        },
  { value: 'luminosity',  label: 'Luminosity'   },
  { value: 'add',         label: 'Add'          },
]

// ── Effects Section ───────────────────────────────────────────────────────────
interface EffectsSectionProps {
  effects: Effects; effective: Effects
  update: (c: Partial<Effects>) => void
  clipTime: number; kfTracks: KeyframeTrack[]
  addKf: (p: string, v: number) => void; removeKf: (p: string) => void
  flat?: boolean
}
function EffectsSection({ effects: base, effective: e, update, clipTime, kfTracks, addKf, removeKf, flat }: EffectsSectionProps) {
  const [open, setOpen] = useState(false)
  const hasEffect = base.brightness !== 100 || base.contrast !== 100 || base.saturate !== 100 ||
                    base.hue !== 0 || base.blur !== 0 || base.opacity !== 100 ||
                    base.grayscale !== 0 || base.sepia !== 0 || base.shadowOpacity > 0 || base.backdropBlur > 0 ||
                    base.compositeMode !== 'normal' ||
                    kfTracks.some(t =>
                      ['brightness','contrast','saturate','hue','blur','opacity','grayscale','sepia'].includes(t.property))

  function kf(prop: string, val: number) {
    const active = hasKeyframeAt(kfTracks, prop, clipTime)
    return { active, toggle: () => active ? removeKf(prop) : addKf(prop, val) }
  }
  function ch(prop: string, v: number) {
    if (hasKeyframeAt(kfTracks, prop, clipTime)) addKf(prop, v)
    else update({ [prop]: v } as Partial<Effects>)
  }

  const grid = (
    <div style={styles.transformGrid}>
      <TRow label="Brightness" min={0}    max={200} step={1}   value={e.brightness} unit="%"  onChange={v => ch('brightness', v)} onReset={() => update({ brightness: 100 })} kf={kf('brightness', e.brightness)} />
      <TRow label="Contrast"   min={0}    max={200} step={1}   value={e.contrast}   unit="%"  onChange={v => ch('contrast',   v)} onReset={() => update({ contrast: 100 })}   kf={kf('contrast',   e.contrast)}   />
      <TRow label="Saturate"   min={0}    max={200} step={1}   value={e.saturate}   unit="%"  onChange={v => ch('saturate',   v)} onReset={() => update({ saturate: 100 })}   kf={kf('saturate',   e.saturate)}   />
      <TRow label="Hue"        min={-180} max={180} step={1}   value={e.hue}        unit="°"  onChange={v => ch('hue',        v)} onReset={() => update({ hue: 0 })}          kf={kf('hue',        e.hue)}        />
      <TRow label="Blur"       min={0}    max={20}  step={0.5} value={e.blur}       unit="px" onChange={v => ch('blur',       v)} onReset={() => update({ blur: 0 })}         kf={kf('blur',       e.blur)}       />
      <TRow label="Opacity"    min={0}    max={100} step={1}   value={e.opacity}    unit="%"  onChange={v => ch('opacity',    v)} onReset={() => update({ opacity: 100 })}    kf={kf('opacity',    e.opacity)}    />
      <TRow label="Grayscale"  min={0}    max={100} step={1}   value={e.grayscale}  unit="%"  onChange={v => ch('grayscale',  v)} onReset={() => update({ grayscale: 0 })}    kf={kf('grayscale',  e.grayscale)}  />
      <TRow label="Sepia"      min={0}    max={100} step={1}   value={e.sepia}      unit="%"  onChange={v => ch('sepia',      v)} onReset={() => update({ sepia: 0 })}        kf={kf('sepia',      e.sepia)}      />

      <div style={{ ...styles.animSelectRow, gridColumn: 'span 2', borderTop: '1px solid #242424', marginTop: 4, paddingTop: 10 }}>
        <span style={{ ...styles.tLabel, color: base.compositeMode !== 'normal' ? '#e6a030' : '#aaa' }}>Composite</span>
        <select
          value={base.compositeMode}
          onChange={ev => update({ compositeMode: ev.target.value as CompositeMode })}
          style={styles.animSelect}
          title="Layer composite mode"
        >
          {COMPOSITE_MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
        </select>
      </div>

      {/* Backdrop Blur */}
      <div style={{ gridColumn: 'span 2', borderTop: '1px solid #242424', marginTop: 4, paddingTop: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: base.backdropBlur > 0 ? '#e6a030' : '#666', letterSpacing: 0.8, display: 'block', marginBottom: 6 }}>BACKDROP BLUR</span>
        <TRow label="Amount" min={0} max={30} step={0.5} value={e.backdropBlur} unit="px" onChange={v => update({ backdropBlur: v })} onReset={() => update({ backdropBlur: 0 })} kf={{ active: false, toggle: () => {} }} />
        {base.backdropBlur > 0 && (
          <>
            <TRow label="Background" min={0} max={100} step={1} value={e.backdropOpacity} unit="%" onChange={v => update({ backdropOpacity: v })} onReset={() => update({ backdropOpacity: 100 })} kf={{ active: false, toggle: () => {} }} />
            <TRow label="Fade" min={0} max={3000} step={50} value={e.backdropBlurFade} unit="ms" onChange={v => update({ backdropBlurFade: v })} onReset={() => update({ backdropBlurFade: 600 })} kf={{ active: false, toggle: () => {} }} />
          </>
        )}
      </div>

      {/* Shadow */}
      <div style={{ gridColumn: 'span 2', borderTop: '1px solid #242424', marginTop: 4, paddingTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: base.shadowOpacity > 0 ? '#e6a030' : '#666', letterSpacing: 0.8 }}>SHADOW</span>
          {base.shadowOpacity > 0 && (
            <input
              type="color"
              value={base.shadowColor ?? '#000000'}
              onChange={e => update({ shadowColor: e.target.value })}
              style={{ width: 26, height: 20, padding: 0, border: '1px solid #444', borderRadius: 3, cursor: 'pointer', background: 'none' }}
              title="Shadow color"
            />
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
          {SHADOW_PRESETS.map(p => (
            <button
              key={p.label}
              style={{ ...styles.kbPresetBtn, ...(p.label === 'None' && base.shadowOpacity === 0 ? styles.kbPresetBtnActive : {}) }}
              onClick={() => update(p.label === 'None' ? { shadowOpacity: 0 } : { ...p.values, shadowColor: base.shadowColor ?? '#000000' })}
            >{p.label}</button>
          ))}
        </div>
        {base.shadowOpacity > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
            <TRow label="Opacity" min={0} max={100} step={1}   value={base.shadowOpacity} unit="%" onChange={v => update({ shadowOpacity: v })} onReset={() => update({ shadowOpacity: 0 })} />
            <TRow label="Blur"    min={0} max={50}  step={0.5} value={base.shadowBlur}    unit="px" onChange={v => update({ shadowBlur: v })}    onReset={() => update({ shadowBlur: 8 })}    />
            <TRow label="X"       min={-50} max={50} step={0.5} value={base.shadowX}      unit="px" onChange={v => update({ shadowX: v })}       onReset={() => update({ shadowX: 4 })}       speed={0.5} />
            <TRow label="Y"       min={-50} max={50} step={0.5} value={base.shadowY}      unit="px" onChange={v => update({ shadowY: v })}       onReset={() => update({ shadowY: 4 })}       speed={0.5} />
          </div>
        )}
      </div>

      {flat && hasEffect && (
        <button style={{ gridColumn: 'span 2', ...styles.resetAllBtnFull }} onClick={() => update({ ...DEFAULT_EFFECTS })}>Reset All</button>
      )}
    </div>
  )

  if (flat) return grid

  return (
    <div style={styles.section}>
      <div style={styles.sectionRow} onClick={() => setOpen(o => !o)}>
        <span style={{ ...styles.sectionTitle, color: hasEffect ? '#e6a030' : undefined }}>Effects</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasEffect && <button style={styles.resetAllBtn} onClick={ev => { ev.stopPropagation(); update({ ...DEFAULT_EFFECTS }) }}>Reset</button>}
          <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
        </div>
      </div>
      {open && grid}
    </div>
  )
}

// ── Focal Point Picker ────────────────────────────────────────────────────────
function FocalPointPicker({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current || !boxRef.current) return
      const r = boxRef.current.getBoundingClientRect()
      onChangeRef.current(
        Math.round(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)) * 10) / 10,
        Math.round(Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100)) * 10) / 10,
      )
    }
    function onUp() { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  function pickAt(e: React.MouseEvent) {
    if (!boxRef.current) return
    const r = boxRef.current.getBoundingClientRect()
    onChangeRef.current(
      Math.round(Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)) * 10) / 10,
      Math.round(Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100)) * 10) / 10,
    )
  }

  return (
    <div
      ref={boxRef}
      style={{ position: 'relative', width: '100%', height: 72, background: '#151515', border: '1px solid #333', borderRadius: 4, cursor: 'crosshair', userSelect: 'none' }}
      onMouseDown={e => { dragging.current = true; pickAt(e) }}
    >
      {/* Rule-of-thirds grid */}
      {[33.3, 66.6].map(p => <div key={`v${p}`} style={{ position: 'absolute', left: `${p}%`, top: 0, bottom: 0, width: 1, background: '#252525' }} />)}
      {[33.3, 66.6].map(p => <div key={`h${p}`} style={{ position: 'absolute', top: `${p}%`, left: 0, right: 0, height: 1, background: '#252525' }} />)}
      {/* Focal dot */}
      <div style={{
        position: 'absolute', left: `${x}%`, top: `${y}%`,
        transform: 'translate(-50%, -50%)',
        width: 11, height: 11, borderRadius: '50%',
        background: '#4af', border: '2px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.6)',
        pointerEvents: 'none',
      }} />
      <span style={{ position: 'absolute', bottom: 3, right: 5, fontSize: 10, color: '#444', pointerEvents: 'none' }}>
        {Math.round(x)}% {Math.round(y)}%
      </span>
    </div>
  )
}

// ── Ken Burns Section ─────────────────────────────────────────────────────────
const KB_PRESETS: Array<{ label: string; kb: KenBurns }> = [
  { label: 'Zoom In',  kb: { startScale: 1.0,  endScale: 1.2,  startX: 0,  startY: 0,  endX: 0,  endY: 0,  focalX: 50, focalY: 50 } },
  { label: 'Zoom Out', kb: { startScale: 1.2,  endScale: 1.0,  startX: 0,  startY: 0,  endX: 0,  endY: 0,  focalX: 50, focalY: 50 } },
  { label: 'Pan →',    kb: { startScale: 1.0, endScale: 1.0, startX: -5, startY: 0,  endX: 5,  endY: 0,  focalX: 50, focalY: 50 } },
  { label: 'Pan ←',    kb: { startScale: 1.0, endScale: 1.0, startX: 5,  startY: 0,  endX: -5, endY: 0,  focalX: 50, focalY: 50 } },
  { label: 'Pan ↓',    kb: { startScale: 1.0, endScale: 1.0, startX: 0,  startY: -5, endX: 0,  endY: 5,  focalX: 50, focalY: 50 } },
  { label: 'Pan ↑',    kb: { startScale: 1.0, endScale: 1.0, startX: 0,  startY: 5,  endX: 0,  endY: -5, focalX: 50, focalY: 50 } },
]

function KenBurnsSection({ kenBurns, update, clipDurationMs = 0, flat }: {
  kenBurns: KenBurns | undefined
  update: (kb: KenBurns | undefined) => void
  clipDurationMs?: number
  flat?: boolean
}) {
  const [open, setOpen] = useState(true)
  const enabled = !!kenBurns
  const kb: KenBurns = kenBurns ?? DEFAULT_KEN_BURNS

  const presetRow = (
    <div style={{ gridColumn: 'span 2', display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
      <button
        style={{ ...styles.kbPresetBtn, ...(!enabled ? styles.kbPresetBtnActive : {}) }}
        onClick={() => update(undefined)}
      >None</button>
      {KB_PRESETS.map(p => (
        <button key={p.label} style={styles.kbPresetBtn} onClick={() => {
          const durS = clipDurationMs / 1000
          const scaleDir = Math.sign(p.kb.endScale - p.kb.startScale)
          if (scaleDir === 0) {
            const posDelta = durS
            const xDir = Math.sign(p.kb.endX - p.kb.startX)
            const yDir = Math.sign(p.kb.endY - p.kb.startY)
            update({
              ...p.kb,
              startX: xDir !== 0 ? -(xDir * posDelta / 2) : 0,
              endX:   xDir !== 0 ?  (xDir * posDelta / 2) : 0,
              startY: yDir !== 0 ? -(yDir * posDelta / 2) : 0,
              endY:   yDir !== 0 ?  (yDir * posDelta / 2) : 0,
            })
          } else {
            update({ ...p.kb, endScale: p.kb.startScale + scaleDir * durS * 0.01 })
          }
        }}>{p.label}</button>
      ))}
    </div>
  )

  const grid = (
    <div style={styles.transformGrid}>
      {presetRow}
      {enabled && (
        <>
          <span style={styles.kbGroupLabel}>Start</span>
          <span style={styles.kbGroupLabel}>End</span>

          <TRow label="Scale" min={50} max={300} step={1} value={Math.round(kb.startScale * 100)} unit="%" onChange={v => update({ ...kb, startScale: v / 100 })} onReset={() => update({ ...kb, startScale: 1 })} />
          <TRow label="Scale" min={50} max={300} step={1} value={Math.round(kb.endScale  * 100)} unit="%" onChange={v => update({ ...kb, endScale:   v / 100 })} onReset={() => update({ ...kb, endScale: 1.15 })} />
          <TRow label="X" min={-50} max={50} step={0.5} value={+kb.startX.toFixed(1)} unit="%" onChange={v => update({ ...kb, startX: v })} onReset={() => update({ ...kb, startX: 0 })} speed={0.4} />
          <TRow label="X" min={-50} max={50} step={0.5} value={+kb.endX.toFixed(1)}   unit="%" onChange={v => update({ ...kb, endX:   v })} onReset={() => update({ ...kb, endX:   0 })} speed={0.4} />
          <TRow label="Y" min={-50} max={50} step={0.5} value={+kb.startY.toFixed(1)} unit="%" onChange={v => update({ ...kb, startY: v })} onReset={() => update({ ...kb, startY: 0 })} speed={0.4} />
          <TRow label="Y" min={-50} max={50} step={0.5} value={+kb.endY.toFixed(1)}   unit="%" onChange={v => update({ ...kb, endY:   v })} onReset={() => update({ ...kb, endY:   0 })} speed={0.4} />

          <div style={{ gridColumn: 'span 2', marginTop: 4 }}>
            <span style={{ ...styles.tCellLabel, display: 'block', marginBottom: 5 }}>Focal Point</span>
            <FocalPointPicker
              x={kb.focalX ?? 50} y={kb.focalY ?? 50}
              onChange={(x, y) => update({ ...kb, focalX: x, focalY: y })}
            />
          </div>

          <button
            style={{ gridColumn: 'span 2', background: '#1a1a24', border: '1px solid #26263a', color: '#777', padding: '6px 0', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginTop: 2 }}
            onClick={() => update({ ...kb, startScale: kb.endScale, endScale: kb.startScale, startX: kb.endX, startY: kb.endY, endX: kb.startX, endY: kb.startY })}
          >
            ⇅ Swap Start / End
          </button>
        </>
      )}
    </div>
  )

  if (flat) return grid

  return (
    <div style={styles.section}>
      <div style={styles.sectionRow} onClick={() => setOpen(o => !o)}>
        <span style={{ ...styles.sectionTitle, color: enabled ? '#e6a030' : undefined }}>Ken Burns</span>
        <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
      </div>
      {open && grid}
    </div>
  )
}

// ── Drag-to-adjust number input ───────────────────────────────────────────────
function DragNumber({ value, min, max, step, speed = 1, onChange }: {
  value: number; min: number; max: number; step: number; speed?: number; onChange: (v: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState('')

  const sensitivity = (max - min) / 1000 * speed

  function onMouseDown(e: React.MouseEvent) {
    if (editing) return
    e.preventDefault()

    const el = e.currentTarget as HTMLElement
    const startVal = value
    let accumulated = 0
    let moved = false

    // Lock pointer so cursor hides and movementX is unbounded (like DaVinci Resolve)
    el.requestPointerLock().catch(() => {})

    function onMove(ev: MouseEvent) {
      if (ev.movementX !== 0) moved = true
      accumulated += ev.movementX
      const factor = ev.shiftKey ? 0.1 : 1
      const raw = startVal + accumulated * sensitivity * factor
      const snapped = Math.round(raw / step) * step
      onChange(Math.min(max, Math.max(min, parseFloat(snapped.toFixed(10)))))
    }

    function onUp() {
      document.exitPointerLock()
      if (!moved) {
        setEditVal(String(value))
        setEditing(true)
      }
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (editing) {
    return (
      <input
        type="number"
        value={editVal}
        autoFocus
        style={styles.tNum}
        onFocus={selectOnFocus}
        onChange={e => setEditVal(e.target.value)}
        onBlur={() => {
          const v = parseFloat(editVal)
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
          setEditing(false)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            const v = parseFloat(editVal)
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
            setEditing(false)
          } else if (e.key === 'Escape') {
            setEditing(false)
          }
          e.stopPropagation()
        }}
      />
    )
  }

  return (
    <div
      style={styles.tNumDrag}
      onMouseDown={onMouseDown}
      title="Drag ←→ to adjust  •  Shift for fine  •  Click to type"
    >
      {value}
    </div>
  )
}

function TRow({ label, min, max, step, value, unit, onChange, onReset, kf, speed, wide }: {
  label: string; min: number; max: number; step: number
  value: number; unit: string; onChange: (v: number) => void; onReset: () => void
  kf?: { active: boolean; toggle: () => void }
  speed?: number
  wide?: boolean
}) {
  if (wide) {
    return (
      <div style={{ ...styles.tRow, gridColumn: 'span 2' }}>
        {kf
          ? <button style={{ ...styles.tKfBtn, color: kf.active ? '#ffcc00' : '#333' }} onClick={kf.toggle} title={kf.active ? 'Remove keyframe' : 'Add keyframe'}>◆</button>
          : <div style={styles.tKfSpacer} />
        }
        <span style={styles.tLabel}>{label}</span>
        <DragNumber value={value} min={min} max={max} step={step} speed={speed} onChange={onChange} />
        <span style={styles.tUnit}>{unit}</span>
        <button style={styles.tReset} onClick={onReset} title="Reset">↺</button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {kf
          ? <button style={{ ...styles.tKfBtn, color: kf.active ? '#ffcc00' : '#333' }} onClick={kf.toggle} title={kf.active ? 'Remove keyframe' : 'Add keyframe'}>◆</button>
          : <div style={styles.tKfSpacer} />
        }
        <span style={styles.tCellLabel}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <DragNumber value={value} min={min} max={max} step={step} speed={speed} onChange={onChange} />
        <span style={styles.tUnit}>{unit}</span>
        <button style={styles.tReset} onClick={onReset} title="Reset">↺</button>
      </div>
    </div>
  )
}

// ── Animation Section ─────────────────────────────────────────────────────────
const IN_EFFECTS:  { value: AnimEffect; label: string }[] = [
  { value: 'none',        label: 'None'             },
  { value: 'fade',        label: 'Fade In'          },
  { value: 'blur-in',     label: 'Blur In'          },
  { value: 'zoom-in',     label: 'Zoom In'          },
  { value: 'zoom-out',    label: 'Zoom Out'         },
  { value: 'slide-left',  label: 'Slide from Left'  },
  { value: 'slide-right', label: 'Slide from Right' },
  { value: 'slide-up',    label: 'Slide from Top'   },
  { value: 'slide-down',  label: 'Slide from Bottom'},
]
const OUT_EFFECTS: { value: AnimEffect; label: string }[] = [
  { value: 'none',        label: 'None'           },
  { value: 'fade',        label: 'Fade Out'       },
  { value: 'blur-out',    label: 'Blur Out'       },
  { value: 'zoom-in',     label: 'Zoom In'        },
  { value: 'zoom-out',    label: 'Zoom Out'       },
  { value: 'slide-left',  label: 'Slide to Left'  },
  { value: 'slide-right', label: 'Slide to Right' },
  { value: 'slide-up',    label: 'Slide to Top'   },
  { value: 'slide-down',  label: 'Slide to Bottom'},
]

function AnimationSection({ animation: a, clipDuration, update, flat }: {
  animation: Animation; clipDuration: number; update: (c: Partial<Animation>) => void; flat?: boolean
}) {
  const [open, setOpen] = useState(true)
  const hasAnim = a.inEffect !== 'none' || a.outEffect !== 'none'
  const maxDur = Math.max(100, Math.floor(clipDuration / 2))

  const grid = (
    <div style={styles.transformGrid}>
      <div style={{ ...styles.animGroupLabel, gridColumn: 'span 2' }}>IN</div>
      <div style={{ ...styles.animSelectRow, gridColumn: 'span 2' }}>
        <span style={styles.tLabel}>Effect</span>
        <select value={a.inEffect} onChange={e => update({ inEffect: e.target.value as AnimEffect })} style={styles.animSelect}>
          {IN_EFFECTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {a.inEffect !== 'none' && (
        <TRow label="Duration" min={50} max={maxDur} step={50} value={a.inDuration} unit="ms"
          onChange={v => update({ inDuration: v })} onReset={() => update({ inDuration: 500 })} wide />
      )}
      <div style={{ ...styles.animGroupLabel, gridColumn: 'span 2', marginTop: 8 }}>OUT</div>
      <div style={{ ...styles.animSelectRow, gridColumn: 'span 2' }}>
        <span style={styles.tLabel}>Effect</span>
        <select value={a.outEffect} onChange={e => update({ outEffect: e.target.value as AnimEffect })} style={styles.animSelect}>
          {OUT_EFFECTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {a.outEffect !== 'none' && (
        <TRow label="Duration" min={50} max={maxDur} step={50} value={a.outDuration} unit="ms"
          onChange={v => update({ outDuration: v })} onReset={() => update({ outDuration: 500 })} wide />
      )}
    </div>
  )

  if (flat) return grid

  return (
    <div style={styles.section}>
      <div style={styles.sectionRow} onClick={() => setOpen(o => !o)}>
        <span style={{ ...styles.sectionTitle, color: hasAnim ? '#e6a030' : undefined }}>Animation</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasAnim && <button style={styles.resetAllBtn} onClick={e => { e.stopPropagation(); update({ ...DEFAULT_ANIMATION }) }}>Reset</button>}
          <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
        </div>
      </div>
      {open && grid}
    </div>
  )
}

// ── Text overlay properties ───────────────────────────────────────────────────
const FALLBACK_TITLE_FONTS = ['sans-serif', 'serif', 'monospace']
let cachedSystemFonts: string[] | null = null

async function loadSystemFonts(): Promise<string[]> {
  if (cachedSystemFonts) return cachedSystemFonts

  try {
    const fonts = await window.api.listSystemFonts()
    cachedSystemFonts = fonts.length > 0 ? fonts : FALLBACK_TITLE_FONTS
  } catch {
    cachedSystemFonts = FALLBACK_TITLE_FONTS
  }

  return cachedSystemFonts
}

function TextProps({ overlay, update }: {
  overlay: TextOverlay
  update: (c: Partial<TextOverlay>) => void
}) {
  const setTitleFontPreview = useEditorStore(s => s.setTitleFontPreview)
  const fontFamily = overlay.fontFamily || 'sans-serif'
  const [systemFonts, setSystemFonts] = useState(cachedSystemFonts ?? FALLBACK_TITLE_FONTS)
  const [fontQuery, setFontQuery] = useState(fontFamily)
  const [fontMenuOpen, setFontMenuOpen] = useState(false)
  const selectingFontRef = useRef(false)

  useEffect(() => {
    return () => setTitleFontPreview(null)
  }, [overlay.id, setTitleFontPreview])

  useEffect(() => {
    let cancelled = false
    loadSystemFonts().then(fonts => {
      if (!cancelled) setSystemFonts(fonts)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!fontMenuOpen) setFontQuery(fontFamily)
  }, [fontFamily, fontMenuOpen])

  const fontOptions = systemFonts.some(font => font.toLocaleLowerCase() === fontFamily.toLocaleLowerCase())
    ? systemFonts
    : [fontFamily, ...systemFonts]
  const fontSearch = fontQuery.trim().toLocaleLowerCase()
  const visibleFonts = fontSearch
    ? fontOptions.filter(font => font.toLocaleLowerCase().includes(fontSearch))
    : fontOptions

  function applyFont(next: string) {
    const family = next.trim()
    if (!family) {
      setFontQuery(fontFamily)
      return
    }
    setTitleFontPreview(null)
    update({ fontFamily: family })
    setFontQuery(family)
    setFontMenuOpen(false)
  }

  function previewFont(next: string) {
    const family = next.trim()
    if (!family) return
    setTitleFontPreview({ overlayId: overlay.id, fontFamily: family })
  }

  function clearFontPreview() {
    setTitleFontPreview(null)
  }

  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>Text</div>
      <label style={styles.label}>Content</label>
      <textarea style={styles.textarea} value={overlay.text} onFocus={selectOnFocus} onChange={e => update({ text: e.target.value })} rows={2} />

      <label style={styles.label}>Font</label>
      <div style={styles.fontPicker}>
        <input
          value={fontMenuOpen ? fontQuery : fontFamily}
          onFocus={() => {
            clearFontPreview()
            setFontMenuOpen(true)
            setFontQuery('')
          }}
          onChange={e => setFontQuery(e.target.value)}
          onBlur={() => {
            setTimeout(() => {
              if (selectingFontRef.current) {
                selectingFontRef.current = false
                return
              }
              clearFontPreview()
              if (fontQuery.trim()) applyFont(fontQuery)
              else setFontQuery(fontFamily)
              setFontMenuOpen(false)
            }, 120)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              applyFont(visibleFonts[0] ?? fontQuery)
            } else if (e.key === 'Escape') {
              clearFontPreview()
              setFontQuery(fontFamily)
              setFontMenuOpen(false)
            }
            e.stopPropagation()
          }}
          placeholder="Search fonts"
          style={styles.input}
        />
        {fontMenuOpen && (
          <div style={styles.fontMenu} onMouseLeave={clearFontPreview}>
            {(visibleFonts.length > 0 ? visibleFonts : [fontQuery]).map(font => (
              <button
                key={font}
                type="button"
                style={{
                  ...styles.fontOption,
                  ...(font.toLocaleLowerCase() === fontFamily.toLocaleLowerCase() ? styles.fontOptionActive : {}),
                }}
                onMouseEnter={() => previewFont(font)}
                onFocus={() => previewFont(font)}
                onMouseDown={e => {
                  selectingFontRef.current = true
                  e.preventDefault()
                  applyFont(font)
                }}
                title={font}
              >
                <span style={{ ...styles.fontOptionName, fontFamily: font }}>{font}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <label style={styles.label}>Font Size</label>
      <div style={styles.row}>
        <input type="range" min={12} max={120} value={overlay.fontSize} onChange={e => update({ fontSize: +e.target.value })} style={styles.range} />
        <span style={styles.value}>{overlay.fontSize}px</span>
      </div>

      <label style={styles.label}>Color</label>
      <input type="color" value={overlay.color} onChange={e => update({ color: e.target.value })} style={styles.colorPicker} />

      <div style={styles.row}>
        <label style={styles.label}>Bold</label>
        <input type="checkbox" checked={overlay.bold} onChange={e => update({ bold: e.target.checked })} />
        <label style={styles.label}>Italic</label>
        <input type="checkbox" checked={overlay.italic} onChange={e => update({ italic: e.target.checked })} />
      </div>

    </div>
  )
}

function TextClipProps({ overlay, update, onDelete }: {
  overlay: TextOverlay
  update: (c: Partial<TextOverlay>) => void
  onDelete: () => void
}) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>Title Clip</div>
      <label style={styles.label}>Video Track</label>
      <input type="number" min={1} value={overlay.trackIndex + 1} onFocus={selectOnFocus} onChange={e => update({ trackIndex: Math.max(0, +e.target.value - 1) })} style={styles.input} />

      <label style={styles.label}>Start (ms)</label>
      <input type="number" value={overlay.startTime} onFocus={selectOnFocus} onChange={e => update({ startTime: Math.max(0, Math.min(+e.target.value, overlay.endTime - 1)) })} style={styles.input} />
      <label style={styles.label}>End (ms)</label>
      <input type="number" value={overlay.endTime} onFocus={selectOnFocus} onChange={e => update({ endTime: Math.max(overlay.startTime + 1, +e.target.value) })} style={styles.input} />

      <button style={styles.deleteBtn} onClick={onDelete}>Delete Title</button>
    </div>
  )
}

// ── Clip trim properties ──────────────────────────────────────────────────────
function ClipProps({ item, clip, update }: {
  item: import('../types').TimelineItem
  clip: import('../types').MediaClip
  update: (c: Partial<import('../types').TimelineItem>) => void
}) {
  return (
    <div style={styles.section}>
      <div style={{ ...styles.sectionTitle, padding: '12px 16px 8px' }}>
        Clip — <span style={{ color: '#bbb', fontWeight: 400 }}>{clip.name}</span>
      </div>
      <label style={styles.label}>Trim Start (ms)</label>
      <input type="number" value={item.trimStart} min={0} max={item.trimEnd - 1} onFocus={selectOnFocus} onChange={e => update({ trimStart: +e.target.value })} style={styles.input} />
      <label style={styles.label}>Trim End (ms)</label>
      <input type="number" value={item.trimEnd} min={item.trimStart + 1} max={clip.duration} onFocus={selectOnFocus} onChange={e => update({ trimEnd: +e.target.value })} style={styles.input} />
      <div style={styles.info}>Duration: {((item.trimEnd - item.trimStart) / 1000).toFixed(2)}s</div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel:       { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#181818' },
  header:      { fontSize: 11, fontWeight: 700, color: '#555', padding: '11px 16px 9px', borderBottom: '1px solid #202020', flexShrink: 0, letterSpacing: 1, textTransform: 'uppercase' },
  section:     { borderBottom: '1px solid #242424' },
  sectionRow:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 9px', cursor: 'pointer', userSelect: 'none' },
  sectionTitle:{ fontSize: 13, color: '#bbb', fontWeight: 600 },
  chevron:     { fontSize: 10, color: '#777', marginLeft: 2 },
  resetAllBtn: { background: 'none', border: '1px solid #333', color: '#777', fontSize: 11, padding: '2px 7px', borderRadius: 3, cursor: 'pointer' },
  resetAllBtnFull: { background: 'none', border: '1px solid #333', color: '#777', fontSize: 11, padding: '5px 0', borderRadius: 4, cursor: 'pointer', marginTop: 4 },

  tabBar:       { display: 'flex', flexWrap: 'wrap', gap: 1, padding: '6px 8px 0', borderBottom: '1px solid #252525', flexShrink: 0, background: '#141414' },
  tabBtn:       { background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#888', fontSize: 11, fontWeight: 600, padding: '5px 8px 6px', cursor: 'pointer', borderRadius: '3px 3px 0 0', letterSpacing: 0.3, transition: 'color 0.1s' },
  tabBtnActive: { color: '#ddd', borderBottomColor: '#e63950' },
  tabContent:   { flex: 1, overflowY: 'auto', minHeight: 0 },

  transformGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', padding: '12px 14px 16px' },
  tRow:      { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px' },
  tKfBtn:    { background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, padding: '0 2px', lineHeight: 1, flexShrink: 0, transition: 'color 0.12s', width: 16, textAlign: 'center' },
  tKfSpacer: { width: 16, flexShrink: 0 },
  tLabel:    { fontSize: 12, color: '#aaa', flex: 1, minWidth: 0, userSelect: 'none' },
  tCellLabel:{ fontSize: 11, color: '#999', userSelect: 'none' },
  tNum:      { width: 56, background: '#1e1e1e', border: '1px solid #484848', color: '#e0e0e0', fontSize: 13, padding: '4px 6px', borderRadius: 4, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  tNumDrag:  { flex: 1, minWidth: 36, background: '#222', border: '1px solid #333', color: '#ddd', fontSize: 13, padding: '4px 6px', borderRadius: 4, textAlign: 'right', cursor: 'ew-resize', userSelect: 'none', fontVariantNumeric: 'tabular-nums' },
  tUnit:     { fontSize: 11, color: '#777', width: 20, flexShrink: 0 },
  tReset:    { background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14, padding: '1px 3px', lineHeight: 1, flexShrink: 0 },

  chainBtn:      { background: 'none', border: '1px solid #333', borderRadius: 4, cursor: 'pointer', padding: '4px 5px', display: 'flex', alignItems: 'center', color: '#666', alignSelf: 'flex-end', flexShrink: 0 },
  chainBtnActive:{ borderColor: '#2abf5a', background: 'rgba(42,191,90,0.08)' },

  flipRow:       { display: 'flex', gap: 8 },
  flipBtn:       { flex: 1, background: '#1e1e1e', border: '1px solid #333', color: '#999', padding: '8px 0', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  flipBtnActive: { background: '#162414', borderColor: '#2abf5a', color: '#2abf5a' },

  animGroupLabel: { fontSize: 11, color: '#777', fontWeight: 700, letterSpacing: 0.8, paddingBottom: 4, marginTop: 6 },
  animSelectRow:  { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  animSelect:     { flex: 1, background: '#1e1e1e', border: '1px solid #333', color: '#ccc', fontSize: 12, borderRadius: 4, padding: '6px 8px' },

  label:       { fontSize: 12, color: '#aaa', padding: '7px 14px 2px', display: 'block' },
  input:       { background: '#1e1e1e', border: '1px solid #2c2c2c', color: '#ddd', borderRadius: 4, padding: '6px 10px', fontSize: 13, margin: '0 14px 6px', display: 'block', width: 'calc(100% - 28px)', boxSizing: 'border-box' },
  fontPicker:  { position: 'relative' },
  fontMenu:    { maxHeight: 210, overflowY: 'auto', margin: '-3px 14px 8px', border: '1px solid #333', borderRadius: 4, background: '#151515', boxShadow: '0 8px 18px rgba(0,0,0,0.35)', padding: 3 },
  fontOption:  { display: 'block', width: '100%', background: 'transparent', border: 'none', color: '#ccc', textAlign: 'left', padding: '6px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12 },
  fontOptionActive: { background: '#2a1620', color: '#fff' },
  fontOptionName: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  textarea:    { background: '#1e1e1e', border: '1px solid #2c2c2c', color: '#ddd', borderRadius: 4, padding: '6px 10px', fontSize: 13, resize: 'vertical', margin: '0 14px 6px', display: 'block', width: 'calc(100% - 28px)', boxSizing: 'border-box' },
  range:       { flex: 1, accentColor: '#e63950', height: 18 },
  value:       { fontSize: 12, color: '#666' },
  colorPicker: { width: 40, height: 26, border: 'none', background: 'none', cursor: 'pointer', padding: 0, margin: '0 14px 4px' },
  row:         { display: 'flex', alignItems: 'center', gap: 10, padding: '4px 14px' },
  deleteBtn:   { background: '#1e0e0e', border: '1px solid #3a1818', color: '#c05050', padding: '7px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, margin: '8px 14px 6px', display: 'block' },
  addTextBtn:  { background: '#162414', border: '1px solid #2abf5a', color: '#5dde76', padding: '9px 0', borderRadius: 5, cursor: 'pointer', fontSize: 13, fontWeight: 600, width: '100%' },
  empty:       { fontSize: 13, color: '#666', textAlign: 'center', padding: '40px 20px', lineHeight: 2, flex: 1 },
  info:        { fontSize: 11, color: '#777', padding: '1px 14px 8px' },
  kbPresetBtn:       { background: '#1a1a24', border: '1px solid #2e2e3e', color: '#aaa', padding: '5px 9px', borderRadius: 4, cursor: 'pointer', fontSize: 11 },
  kbPresetBtnActive: { background: '#2d1560', border: '1px solid #7040e0', color: '#c0a0ff' },
  kbGroupLabel:{ fontSize: 11, color: '#888', fontWeight: 700, letterSpacing: 0.8, paddingBottom: 3, marginTop: 4 },
}
