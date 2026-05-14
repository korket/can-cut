import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { IpcMain } from 'electron'

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  thumbnail?: string | null
}

export type ProjectVersionKind = 'manual' | 'auto'

export interface ProjectVersionMeta {
  id: string
  projectId: string
  label: string
  kind: ProjectVersionKind
  createdAt: string
  projectUpdatedAt?: string
  thumbnail?: string | null
  clipCount: number
  timelineItemCount: number
  textOverlayCount: number
}

export interface ProjectRecoverySnapshot extends ProjectVersionMeta {
  data: string
}

export interface ProjectStore {
  list(): Promise<ProjectMeta[]>
  create(name: string): Promise<ProjectMeta>
  save(id: string, data: string): Promise<void>
  load(id: string): Promise<string | null>
  delete(id: string): Promise<void>
  rename(id: string, name: string): Promise<void>
  listVersions(id: string): Promise<ProjectVersionMeta[]>
  createVersion(id: string, data: string, options?: { label?: string; kind?: ProjectVersionKind }): Promise<ProjectVersionMeta>
  loadVersion(id: string, versionId: string): Promise<string | null>
  deleteVersion(id: string, versionId: string): Promise<void>
  duplicateVersion(id: string, versionId: string, name?: string): Promise<ProjectMeta>
  saveRecovery(id: string, data: string): Promise<void>
  loadRecovery(id: string): Promise<ProjectRecoverySnapshot | null>
}

interface ProjectVersionEnvelope {
  schemaVersion: 1
  id: string
  projectId: string
  label: string
  kind: ProjectVersionKind
  createdAt: string
  data: any
}

function projectMeta(data: any): ProjectMeta {
  const timeline = data.timelines?.find((candidate: any) => candidate.id === data.activeTimelineId) ?? data.timelines?.[0]
  const firstItem = timeline?.items?.[0] ?? data.timelineItems?.[0]
  const clips = data.media?.clips ?? data.clips ?? []
  const clip = firstItem ? clips.find((candidate: any) => candidate.id === firstItem.clipId) : null

  return {
    id: data.id,
    name: data.name,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    thumbnail: data.thumbnail ?? clip?.thumbnail ?? null,
  }
}

function projectCounts(data: any) {
  const timeline = data.timelines?.find((candidate: any) => candidate.id === data.activeTimelineId) ?? data.timelines?.[0]
  return {
    clipCount: Array.isArray(data.media?.clips) ? data.media.clips.length : Array.isArray(data.clips) ? data.clips.length : 0,
    timelineItemCount: Array.isArray(timeline?.items) ? timeline.items.length : Array.isArray(data.timelineItems) ? data.timelineItems.length : 0,
    textOverlayCount: Array.isArray(timeline?.textOverlays) ? timeline.textOverlays.length : Array.isArray(data.textOverlays) ? data.textOverlays.length : 0,
  }
}

function versionMeta(envelope: ProjectVersionEnvelope): ProjectVersionMeta {
  const counts = projectCounts(envelope.data)
  return {
    id: envelope.id,
    projectId: envelope.projectId,
    label: envelope.label,
    kind: envelope.kind,
    createdAt: envelope.createdAt,
    projectUpdatedAt: envelope.data?.updatedAt,
    thumbnail: projectMeta(envelope.data).thumbnail ?? null,
    ...counts,
  }
}

async function writeTextAtomic(path: string, data: string) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(tempPath, data, 'utf8')
  try {
    await fs.rename(tempPath, path)
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {})
    throw error
  }
}

async function writeJsonAtomic(path: string, data: unknown) {
  await writeTextAtomic(path, JSON.stringify(data))
}

function parseProjectData(data: string) {
  const parsed = JSON.parse(data)
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid project data')
  return parsed
}

export function createProjectStore(getProjectsDir: () => string): ProjectStore {
  const projectsDir = () => getProjectsDir()
  const projectPath = (id: string) => join(projectsDir(), `${id}.json`)
  const versionsDir = (id: string) => join(projectsDir(), `${id}.versions`)
  const versionPath = (id: string, versionId: string) => join(versionsDir(id), `${versionId}.json`)
  const recoveryPath = (id: string) => join(versionsDir(id), 'latest.recovery.json')

  async function ensureProjectsDir() {
    await fs.mkdir(projectsDir(), { recursive: true }).catch(() => {})
  }

  async function ensureVersionsDir(id: string) {
    await fs.mkdir(versionsDir(id), { recursive: true }).catch(() => {})
  }

  async function readVersionEnvelope(id: string, versionId: string): Promise<ProjectVersionEnvelope | null> {
    try {
      const raw = await fs.readFile(versionPath(id, versionId), 'utf8')
      const envelope = JSON.parse(raw) as ProjectVersionEnvelope
      if (!envelope || envelope.schemaVersion !== 1 || envelope.projectId !== id || !envelope.data) return null
      return envelope
    } catch {
      return null
    }
  }

  async function readVersionEnvelopes(id: string): Promise<ProjectVersionEnvelope[]> {
    const dir = versionsDir(id)
    const files = await fs.readdir(dir).catch(() => [] as string[])
    const versions: ProjectVersionEnvelope[] = []

    for (const file of files) {
      if (!file.endsWith('.json') || file === 'latest.recovery.json') continue
      const versionId = file.slice(0, -'.json'.length)
      const envelope = await readVersionEnvelope(id, versionId)
      if (envelope) versions.push(envelope)
    }

    return versions
  }

  async function pruneAutoVersions(id: string, keep = 30) {
    const versions = await readVersionEnvelopes(id)
    const autoVersions = versions
      .filter((version) => version.kind === 'auto')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    for (const stale of autoVersions.slice(keep)) {
      await fs.unlink(versionPath(id, stale.id)).catch(() => {})
    }
  }

  return {
    async list() {
      await ensureProjectsDir()
      const files = await fs.readdir(projectsDir()).catch(() => [] as string[])
      const list: ProjectMeta[] = []

      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = await fs.readFile(join(projectsDir(), file), 'utf8')
          const data = JSON.parse(raw)
          list.push(projectMeta(data))
        } catch {}
      }

      return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    },

    async create(name: string) {
      await ensureProjectsDir()
      const id = randomUUID()
      const now = new Date().toISOString()
      const project = {
        schemaVersion: 1,
        id,
        name,
        createdAt: now,
        updatedAt: now,
        thumbnail: null,
        settings: { fps: 30, zoom: 100, videoTrackCount: 2, audioTrackCount: 2 },
        media: { clips: [], folders: [] },
        timelines: [{ id: 'main', name: 'Main Timeline', items: [], textOverlays: [] }],
        activeTimelineId: 'main',
      }

      await writeJsonAtomic(projectPath(id), project)
      return { id, name, createdAt: now, updatedAt: now, thumbnail: null }
    },

    async save(id: string, data: string) {
      await ensureProjectsDir()
      await writeTextAtomic(projectPath(id), data)
    },

    async load(id: string) {
      try {
        return await fs.readFile(projectPath(id), 'utf8')
      } catch {
        return null
      }
    },

    async delete(id: string) {
      await fs.unlink(projectPath(id)).catch(() => {})
      await fs.rm(versionsDir(id), { recursive: true, force: true }).catch(() => {})
    },

    async rename(id: string, name: string) {
      const path = projectPath(id)

      try {
        const data = JSON.parse(await fs.readFile(path, 'utf8'))
        data.name = name
        data.updatedAt = new Date().toISOString()
        await writeJsonAtomic(path, data)
      } catch {}
    },

    async listVersions(id: string) {
      await ensureVersionsDir(id)
      const versions = await readVersionEnvelopes(id)
      return versions
        .map(versionMeta)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    },

    async createVersion(id: string, data: string, options = {}) {
      await ensureVersionsDir(id)
      const parsed = parseProjectData(data)
      const versionId = randomUUID()
      const now = new Date().toISOString()
      const kind = options.kind ?? 'manual'
      const label = (options.label?.trim() || (kind === 'auto' ? 'Autosave' : 'Untitled version')).slice(0, 120)
      const envelope: ProjectVersionEnvelope = {
        schemaVersion: 1,
        id: versionId,
        projectId: id,
        label,
        kind,
        createdAt: now,
        data: parsed,
      }

      await writeJsonAtomic(versionPath(id, versionId), envelope)
      if (kind === 'auto') await pruneAutoVersions(id)
      return versionMeta(envelope)
    },

    async loadVersion(id: string, versionId: string) {
      const envelope = await readVersionEnvelope(id, versionId)
      return envelope ? JSON.stringify(envelope.data) : null
    },

    async deleteVersion(id: string, versionId: string) {
      await fs.unlink(versionPath(id, versionId)).catch(() => {})
    },

    async duplicateVersion(id: string, versionId: string, name?: string) {
      await ensureProjectsDir()
      const envelope = await readVersionEnvelope(id, versionId)
      if (!envelope) throw new Error('Version not found')

      const newId = randomUUID()
      const now = new Date().toISOString()
      const sourceName = String(envelope.data?.name ?? 'Untitled Project')
      const projectName = (name?.trim() || `${sourceName} copy`).slice(0, 120)
      const data = {
        ...envelope.data,
        id: newId,
        name: projectName,
        createdAt: now,
        updatedAt: now,
      }

      await writeJsonAtomic(projectPath(newId), data)
      return projectMeta(data)
    },

    async saveRecovery(id: string, data: string) {
      await ensureVersionsDir(id)
      const parsed = parseProjectData(data)
      const now = new Date().toISOString()
      const envelope: ProjectVersionEnvelope = {
        schemaVersion: 1,
        id: 'latest-recovery',
        projectId: id,
        label: 'Latest recovery',
        kind: 'auto',
        createdAt: now,
        data: parsed,
      }
      await writeJsonAtomic(recoveryPath(id), envelope)
    },

    async loadRecovery(id: string) {
      try {
        const raw = await fs.readFile(recoveryPath(id), 'utf8')
        const envelope = JSON.parse(raw) as ProjectVersionEnvelope
        if (!envelope || envelope.schemaVersion !== 1 || envelope.projectId !== id || !envelope.data) return null
        return {
          ...versionMeta(envelope),
          data: JSON.stringify(envelope.data),
        }
      } catch {
        return null
      }
    },
  }
}

export function registerProjectIpc(ipcMain: IpcMain, projectStore: ProjectStore): void {
  ipcMain.handle('project:list', () => projectStore.list())
  ipcMain.handle('project:create', (_event, name: string) => projectStore.create(name))
  ipcMain.handle('project:save', (_event, id: string, data: string) => projectStore.save(id, data))
  ipcMain.handle('project:load', (_event, id: string) => projectStore.load(id))
  ipcMain.handle('project:delete', (_event, id: string) => projectStore.delete(id))
  ipcMain.handle('project:rename', (_event, id: string, name: string) => projectStore.rename(id, name))
  ipcMain.handle('project:versions:list', (_event, id: string) => projectStore.listVersions(id))
  ipcMain.handle('project:versions:create', (_event, id: string, data: string, options?: { label?: string; kind?: ProjectVersionKind }) => projectStore.createVersion(id, data, options))
  ipcMain.handle('project:versions:load', (_event, id: string, versionId: string) => projectStore.loadVersion(id, versionId))
  ipcMain.handle('project:versions:delete', (_event, id: string, versionId: string) => projectStore.deleteVersion(id, versionId))
  ipcMain.handle('project:versions:duplicate', (_event, id: string, versionId: string, name?: string) => projectStore.duplicateVersion(id, versionId, name))
  ipcMain.handle('project:recovery:save', (_event, id: string, data: string) => projectStore.saveRecovery(id, data))
  ipcMain.handle('project:recovery:load', (_event, id: string) => projectStore.loadRecovery(id))
}
