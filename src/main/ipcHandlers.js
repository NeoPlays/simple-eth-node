import { ipcMain, BrowserWindow, net } from "electron";
import storage from "@main/store/StoreService"
import nodeManager from "@main/nodes/NodeManager"
import { Node } from "@main/nodes/Node";
import log from 'electron-log'
import _ from 'lodash'
import { randomUUID } from 'crypto'

const logSessions = new Map() // sessionId -> { handle, nodeId }

function broadcast(channel, payload) {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

const UPDATES_MANIFEST_URL = 'https://stereum.com/downloads/updates.json'
const UPDATES_MANIFEST_TTL_MS = 5 * 60 * 1000
let _manifestCache = null

function fetchUpdatesManifest() {
    if (_manifestCache && Date.now() - _manifestCache.fetchedAt < UPDATES_MANIFEST_TTL_MS) {
        return Promise.resolve(_manifestCache.data)
    }
    return new Promise((resolve, reject) => {
        const request = net.request(UPDATES_MANIFEST_URL)
        let body = ''
        request.on('response', (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`updates.json HTTP ${res.statusCode}`))
                return
            }
            res.on('data', (chunk) => { body += chunk.toString('utf8') })
            res.on('end', () => {
                try {
                    const data = JSON.parse(body)
                    _manifestCache = { data, fetchedAt: Date.now() }
                    resolve(data)
                } catch (e) {
                    reject(new Error(`updates.json parse failed: ${e.message}`))
                }
            })
            res.on('error', reject)
        })
        request.on('error', reject)
        request.end()
    })
}

export function initializeIpcHandlers() {
    // IPC test
    ipcMain.handle('ping', () => log.debug('pong'));

    // IPC StoreService
    ipcMain.handle('import-server-from-stereum', () => {return storage.importFromStereum()});
    ipcMain.handle('store-get', (_, key) => storage.get(key));
    ipcMain.handle('store-set', (_, key, value) => storage.set(key, value));

    // IPC NodeManager
    ipcMain.handle('ssh-login', (_, credentials) => {
        const existing = nodeManager.findNodeByEndpoint(credentials.host, credentials.port, credentials.username)
        if (existing) {
            return Promise.resolve({
                code: 2,
                message: `Already connected to ${credentials.username}@${credentials.host}:${credentials.port}`,
                nodeId: existing.id,
            })
        }
        const node = new Node(credentials)
        node.onStatusChange((status) => {
            for (const w of BrowserWindow.getAllWindows()) {
                w.webContents.send('node-status-changed', { id: node.id, status })
            }
        })
        return node.sshService.connect().then((data) => {
            nodeManager.addNode(node);
            return data;
        }).catch((error) => {
            log.error('SSH login error:', error);
            return {code: 1, message: error.message || 'SSH login error'};
        });
    });

    ipcMain.handle('get-all-nodes', () => {
        return nodeManager.getAllNodes()
    });

    ipcMain.handle('get-node', async (_, nodeId) => {
        try {
            return await nodeManager.getNode(nodeId);
        } catch (error) {
            log.error('get-node error:', error);
            throw error;
        }
    });

    ipcMain.handle('reconnect-node', async (_, nodeId) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.reconnect()
        } catch (error) {
            log.error('reconnect-node error:', error)
            return false
        }
    });

    ipcMain.handle('disconnect-node', async (_, nodeId) => {
        try {
            for (const [sessionId, session] of logSessions) {
                if (session.nodeId !== nodeId) continue
                try { session.handle.abort() } catch { /* ignore */ }
                logSessions.delete(sessionId)
            }
            nodeManager.disconnectNode(nodeId)
        } catch (error) {
            log.error('disconnect-node error:', error);
        }
    });

    ipcMain.handle('start-service', async (_, nodeId, serviceId) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.startService(serviceId)
        } catch (error) {
            log.error('start-service error:', error)
            throw error
        }
    });

    ipcMain.handle('stop-service', async (_, nodeId, serviceId) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.stopService(serviceId)
        } catch (error) {
            log.error('stop-service error:', error)
            throw error
        }
    });

    ipcMain.handle('restart-service', async (_, nodeId, serviceId) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.restartService(serviceId)
        } catch (error) {
            log.error('restart-service error:', error)
            throw error
        }
    });

    ipcMain.handle('restart-changed-services', async (_, nodeId, timeScopeSeconds, prune = true) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.restartChangedServices(timeScopeSeconds, { prune })
        } catch (error) {
            log.error('restart-changed-services error:', error)
            throw error
        }
    });

    ipcMain.handle('fetch-updates-manifest', async () => {
        try {
            return await fetchUpdatesManifest()
        } catch (error) {
            log.error('fetch-updates-manifest error:', error)
            throw error
        }
    });

    ipcMain.handle('service-logs-start', async (_, nodeId, serviceId, tail) => {
        const node = nodeManager.findNode(nodeId)
        if (!node) throw new Error('Node not found')
        const sessionId = randomUUID()
        const handle = await node.streamServiceLogs(serviceId, {
            tail,
            onLine: (line) => broadcast('service-log-data', { sessionId, line }),
            onClose: ({ rc, error }) => {
                logSessions.delete(sessionId)
                broadcast('service-log-closed', { sessionId, rc, error: error?.message })
            },
        })
        logSessions.set(sessionId, { handle, nodeId })
        return sessionId
    });

    ipcMain.handle('service-logs-stop', (_, sessionId) => {
        const session = logSessions.get(sessionId)
        if (!session) return
        try { session.handle.abort() } catch (e) { log.warn('service-logs-stop abort threw:', e?.message || e) }
        // onClose will delete the entry; ensure cleanup even if no close event fires
        logSessions.delete(sessionId)
    });

    ipcMain.handle('get-controls-commit', async (_, nodeId) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.fetchControlsCommit()
        } catch (error) {
            log.error('get-controls-commit error:', error)
            throw error
        }
    });

    ipcMain.handle('get-upgradable-packages', async (_, nodeId) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.fetchUpgradablePackages()
        } catch (error) {
            log.error('get-upgradable-packages error:', error)
            throw error
        }
    });

    ipcMain.handle('update-os', async (_, nodeId) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.updateOS()
        } catch (error) {
            log.error('update-os error:', error)
            throw error
        }
    });

    ipcMain.handle('update-package', async (_, nodeId, name) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.updatePackage(name)
        } catch (error) {
            log.error('update-package error:', error)
            throw error
        }
    });

    ipcMain.handle('update-services', async (_, nodeId, serviceIds = null) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.updateServices(serviceIds)
        } catch (error) {
            log.error('update-services error:', error)
            throw error
        }
    });

    ipcMain.handle('update-stereum', async (_, nodeId, commit = null) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.updateStereum(commit)
        } catch (error) {
            log.error('update-stereum error:', error)
            throw error
        }
    });

    ipcMain.handle('run-full-update', async (_, nodeId, commit = null, prune = true) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.runFullUpdate(commit, { prune })
        } catch (error) {
            log.error('run-full-update error:', error)
            throw error
        }
    });

    ipcMain.handle('get-container-statuses', async (_, nodeId) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.fetchContainerStatuses()
        } catch (error) {
            log.error('get-container-statuses error:', error)
            throw error
        }
    });

    ipcMain.handle('get-raw-service-config', async (_, nodeId, serviceId) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            return await node.fetchRawServiceConfig(serviceId)
        } catch (error) {
            log.error('get-raw-service-config error:', error)
            throw error
        }
    });

    ipcMain.handle('write-service-config', async (_, nodeId, serviceId, content) => {
        try {
            const node = nodeManager.findNode(nodeId)
            if (!node) throw new Error('Node not found')
            await node.writeServiceConfig(serviceId, content)
        } catch (error) {
            log.error('write-service-config error:', error)
            throw error
        }
    });
}
