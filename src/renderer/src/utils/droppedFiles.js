// Files from a drag-and-drop, folders included.
//
// Keystores usually arrive as the `validator_keys` folder the deposit CLI writes, so a dropped
// directory is walked (one level of nesting is plenty, but the walk is recursive anyway) and every
// `.json` file in it is read. `DataTransfer.files` alone would list a dropped folder as one empty,
// unreadable entry - the entry API (`webkitGetAsEntry`) is what exposes its contents.

/** Read all entries of a directory; `readEntries` returns them in batches until an empty one. */
function readAllEntries(dirEntry) {
    const reader = dirEntry.createReader()
    return new Promise((resolve, reject) => {
        const all = []
        const next = () => reader.readEntries((batch) => {
            if (!batch.length) return resolve(all)
            all.push(...batch)
            next()
        }, reject)
        next()
    })
}

const fileOf = (fileEntry) => new Promise((resolve, reject) => fileEntry.file(resolve, reject))

/** File objects for every file under the given entries (directories walked recursively). */
export async function filesFromEntries(entries) {
    const out = []
    for (const entry of entries) {
        if (!entry) continue
        if (entry.isFile) out.push(await fileOf(entry))
        else if (entry.isDirectory) out.push(...await filesFromEntries(await readAllEntries(entry)))
    }
    return out
}

/**
 * `[{ name, content }]` for every `.json` file in a drop, plus how many other files were ignored.
 * The `{ name, content }` shape matches what the `pick-json-files` dialog returns, so both paths
 * feed the same validation.
 */
export async function readDroppedJson(dataTransfer) {
    const items = Array.from(dataTransfer?.items || [])
    const entries = items.map((i) => (i.kind === 'file' && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    const files = entries.some(Boolean)
        ? await filesFromEntries(entries)
        : Array.from(dataTransfer?.files || [])
    const json = files.filter((f) => /\.json$/i.test(f.name))
    const read = await Promise.all(json.map(async (f) => ({ name: f.name, content: await f.text() })))
    return { files: read, ignored: files.length - json.length }
}
