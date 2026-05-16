import type { RenderPlan } from '../editor-core/renderPlan'
import { DEFAULT_EXPORT_PROFILE, type ExportProfile } from '../editor-core/exportSettings'
import {
  createExportJobStartRequest,
  isTerminalExportStatus,
  type ExportJob,
  type ExportJobLogEntry,
  type ExportJobResult,
} from './exportJob'

export interface ExportJobSnapshot extends ExportJob {
  logs: ExportJobLogEntry[]
  result?: ExportJobResult
}

type ExportJobListener = () => void

function sortJobs(jobs: ExportJobSnapshot[]): ExportJobSnapshot[] {
  return [...jobs].sort((a, b) => b.createdAt - a.createdAt)
}

function isExportJobSnapshot(value: unknown): value is ExportJobSnapshot {
  if (!value || typeof value !== 'object') return false

  const snapshot = value as Partial<ExportJobSnapshot>
  return (
    typeof snapshot.id === 'string' &&
    typeof snapshot.createdAt === 'number' &&
    typeof snapshot.updatedAt === 'number' &&
    typeof snapshot.progress === 'number' &&
    typeof snapshot.status === 'string' &&
    typeof snapshot.mode === 'string' &&
    typeof snapshot.backend === 'string' &&
    Boolean(snapshot.profile) &&
    Boolean(snapshot.preflight) &&
    Boolean(snapshot.timing) &&
    Array.isArray(snapshot.logs)
  )
}

function isCanceledStartResult(value: unknown): value is { canceled: true } {
  return Boolean(value && typeof value === 'object' && (value as { canceled?: unknown }).canceled === true)
}

function isErrorResult(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string')
}

class ExportJobManager {
  private jobs: ExportJobSnapshot[] = []
  private listeners = new Set<ExportJobListener>()
  private lastStartError: string | null = null

  constructor() {
    void this.refresh()

    window.api.onExportJobsChanged((jobs) => {
      this.setJobs(jobs)
    })
  }

  subscribe(listener: ExportJobListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(plan: RenderPlan, profile: ExportProfile = DEFAULT_EXPORT_PROFILE): Promise<ExportJobSnapshot | null> {
    const result = await window.api.startExportJob(createExportJobStartRequest(plan, profile))
    this.lastStartError = null
    if (isCanceledStartResult(result)) return null
    if (isErrorResult(result)) {
      this.lastStartError = result.error
      this.notify()
      return null
    }
    if (!isExportJobSnapshot(result)) {
      this.lastStartError = 'Export job could not be started.'
      this.notify()
      return null
    }

    const job = result
    this.upsert(job)
    this.notify()
    return job
  }

  getLastStartError(): string | null {
    return this.lastStartError
  }

  getJob(jobId: string): ExportJobSnapshot | null {
    return this.jobs.find((job) => job.id === jobId) ?? null
  }

  getJobs(): ExportJobSnapshot[] {
    return sortJobs(this.jobs)
  }

  getLatestActiveJob(): ExportJobSnapshot | null {
    return this.getJobs().find((job) => !isTerminalExportStatus(job.status)) ?? null
  }

  async cancel(jobId: string): Promise<void> {
    await window.api.cancelExportJob(jobId)
  }

  remove(jobId: string): void {
    void window.api.removeExportJob(jobId)
  }

  private async refresh(): Promise<void> {
    const jobs = await window.api.getExportJobs()
    this.setJobs(jobs)
  }

  private setJobs(jobs: unknown[]): void {
    this.jobs = sortJobs(jobs.filter(isExportJobSnapshot))
    this.notify()
  }

  private upsert(job: ExportJobSnapshot): void {
    this.jobs = sortJobs([
      job,
      ...this.jobs.filter((candidate) => candidate.id !== job.id),
    ])
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

export const exportJobManager = new ExportJobManager()
