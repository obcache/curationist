import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const pkgPath = path.join(repoRoot, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const oldVer = String(pkg.version || '1.2.0').trim()
const parts = oldVer.split('.').map((n) => Number.parseInt(n, 10) || 0)
while (parts.length < 3) parts.push(0)
parts[2] += 1
const newVer = `${parts[0]}.${parts[1]}.${parts[2]}`

pkg.version = newVer
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

// Sync installer/curationist.iss (#define MyAppVersion "x.y.z")
const issPath = path.join(repoRoot, 'installer', 'curationist.iss')
if (fs.existsSync(issPath)) {
  const issContent = fs.readFileSync(issPath, 'utf8')
  const updatedIss = issContent.replace(
    /#define\s+MyAppVersion\s+"[^"]+"/,
    `#define MyAppVersion "${newVer}"`
  )
  fs.writeFileSync(issPath, updatedIss, 'utf8')
}

// Sync vendor/obs-plugin/milkyway-install.json
const obsJsonPath = path.join(repoRoot, 'vendor', 'obs-plugin', 'milkyway-install.json')
if (fs.existsSync(obsJsonPath)) {
  const obsJson = JSON.parse(fs.readFileSync(obsJsonPath, 'utf8'))
  obsJson.version = newVer
  fs.writeFileSync(obsJsonPath, `${JSON.stringify(obsJson, null, 2)}\n`, 'utf8')

  const progDataJson = 'C:/ProgramData/obs-studio/plugins/milkyway/milkyway-install.json'
  if (fs.existsSync(progDataJson)) {
    try {
      fs.copyFileSync(obsJsonPath, progDataJson)
    } catch {
      // ignore if protected
    }
  }
}

console.log(`==> Bumped Curationist version: ${oldVer} -> ${newVer} (package.json, curationist.iss, milkyway-install.json)`)
