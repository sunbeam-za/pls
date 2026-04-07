import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// The CLAUDE.md lives at the repo root (one level up from the landing app).
// Read it at build time so the landing page stays in sync with the source
// of truth automatically — no manual copy step.
export async function getClaudeMd() {
  try {
    const path = join(process.cwd(), '..', 'CLAUDE.md')
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}
