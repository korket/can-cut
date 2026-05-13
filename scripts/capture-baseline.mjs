import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import os from 'node:os'

const root = process.cwd()
const runBuild = process.argv.includes('--build')

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
  } catch (error) {
    return error.stdout?.toString().trim() || error.stderr?.toString().trim() || String(error)
  }
}

function runNpm(args) {
  if (process.platform === 'win32') return run('cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')])
  return run('npm', args)
}

function countFiles(dir, predicate) {
  if (!existsSync(dir)) return 0
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) count += countFiles(path, predicate)
    else if (predicate(path)) count++
  }
  return count
}

function fileIncludes(path, text) {
  return existsSync(path) && readFileSync(path, 'utf8').includes(text)
}

function measureBuild() {
  const started = performance.now()
  const result = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ended = performance.now()
  return {
    attempted: true,
    success: result.status === 0,
    exitCode: result.status,
    error: result.error ? String(result.error) : null,
    durationMs: Math.round(ended - started),
    stdoutTail: (result.stdout ?? '').slice(-4000),
    stderrTail: (result.stderr ?? '').slice(-4000),
  }
}

const exportRendererPath = join(root, 'src', 'renderer', 'src', 'utils', 'exportRenderer.ts')
const exportModalPath = join(root, 'src', 'renderer', 'src', 'components', 'ExportModal.tsx')
const mainPath = join(root, 'src', 'main', 'index.ts')

const report = {
  capturedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    node: process.version,
    npm: runNpm(['--version']),
  },
  git: {
    branch: run('git', ['branch', '--show-current']),
    commit: run('git', ['rev-parse', 'HEAD']),
  },
  source: {
    tsFiles: countFiles(join(root, 'src'), p => /\.tsx?$/.test(p)),
    rendererComponentFiles: countFiles(join(root, 'src', 'renderer', 'src', 'components'), p => /\.tsx$/.test(p)),
    relativeExportRenderer: relative(root, exportRendererPath),
  },
  exportImplementation: {
    exportModalUsesCanvasRenderer: fileIncludes(exportModalPath, 'renderAndExport'),
    canvasRendererUsesFrameLoop: fileIncludes(exportRendererPath, 'for (let f = 0; f < frameCount; f++)'),
    canvasRendererEncodesJpegFrames: fileIncludes(exportRendererPath, "canvas.toBlob") && fileIncludes(exportRendererPath, "image/jpeg"),
    canvasRendererUsesIpcFrameSend: fileIncludes(exportRendererPath, 'sendExportFrame'),
    mainHasDirectFfmpegExportHandler: fileIncludes(mainPath, "ipcMain.handle('ffmpeg:export'"),
    mainHasFramePipeExportHandler: fileIncludes(mainPath, "ipcMain.handle('export:frameStart'"),
    framePipePresetMedium: fileIncludes(mainPath, "'-preset', 'medium'"),
  },
  build: runBuild ? measureBuild() : { attempted: false },
  manualExportBenchmarks: {
    captured: false,
    reason: 'Requires interactive Electron export fixture and output path selection.',
  },
}

const outDir = join(root, 'benchmarks')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'baseline-current.json')
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)

console.log(`Baseline written to ${relative(root, outPath)}`)
if (report.build.attempted) {
  console.log(`Build ${report.build.success ? 'passed' : 'failed'} in ${report.build.durationMs}ms`)
  if (!report.build.success) process.exitCode = 1
}
