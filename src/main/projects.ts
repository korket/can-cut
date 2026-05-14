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

export interface ProjectStore {
  list(): Promise<ProjectMeta[]>
  create(name: string): Promise<ProjectMeta>
  save(id: string, data: string): Promise<void>
  load(id: string): Promise<string | null>
  delete(id: string): Promise<void>
  rename(id: string, name: string): Promise<void>
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

export function createProjectStore(getProjectsDir: () => string): ProjectStore {
  const projectsDir = () => getProjectsDir()
  const projectPath = (id: string) => join(projectsDir(), `${id}.json`)

  async function ensureProjectsDir() {
    await fs.mkdir(projectsDir(), { recursive: true }).catch(() => {})
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

      await fs.writeFile(projectPath(id), JSON.stringify(project), 'utf8')
      return { id, name, createdAt: now, updatedAt: now, thumbnail: null }
    },

    async save(id: string, data: string) {
      await ensureProjectsDir()
      await fs.writeFile(projectPath(id), data, 'utf8')
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
    },

    async rename(id: string, name: string) {
      const path = projectPath(id)

      try {
        const data = JSON.parse(await fs.readFile(path, 'utf8'))
        data.name = name
        data.updatedAt = new Date().toISOString()
        await fs.writeFile(path, JSON.stringify(data), 'utf8')
      } catch {}
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
}
