declare module 'sqlite-vec' {
  interface Db {
    loadExtension(file: string, entrypoint?: string | undefined): void
  }
  export function getLoadablePath(): string
  export function load(db: Db): void
}
