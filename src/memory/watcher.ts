import { watch, type FSWatcher } from 'chokidar'
import * as path from 'path'

export interface WatcherCallbacks {
  onFileChanged: (absolutePath: string) => void
  onFileRemoved: (absolutePath: string) => void
}

export class MemoryWatcher {
  private watcher: FSWatcher | null = null

  start(dataDir: string, callbacks: WatcherCallbacks): void {
    const watchPaths = [
      path.join(dataDir, 'MEMORY.md'),
      path.join(dataDir, 'memory', '*.md'),
      path.join(dataDir, 'traces', '*.md'),
    ]

    this.watcher = watch(watchPaths, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 200,
      },
      depth: 0,
    })

    this.watcher.on('add', (filePath: string) => {
      callbacks.onFileChanged(path.resolve(filePath))
    })

    this.watcher.on('change', (filePath: string) => {
      callbacks.onFileChanged(path.resolve(filePath))
    })

    this.watcher.on('unlink', (filePath: string) => {
      callbacks.onFileRemoved(path.resolve(filePath))
    })
  }

  close(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }
}
