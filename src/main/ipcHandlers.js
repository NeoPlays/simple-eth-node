import { ipcMain, BrowserWindow } from "electron";
import storage from "@main/store/StoreService"
import nodeManager from "@main/nodes/NodeManager"
import { Node } from "@main/nodes/Node";
import log from 'electron-log'
import _ from 'lodash'

export function initializeIpcHandlers() {
    // IPC test
    ipcMain.handle('ping', () => log.debug('pong'));

    // IPC StoreService
    ipcMain.handle('import-server-from-stereum', () => {return storage.importFromStereum()});
    ipcMain.handle('store-get', (_, key) => storage.get(key));
    ipcMain.handle('store-set', (_, key, value) => storage.set(key, value));

    // IPC NodeManager
    ipcMain.handle('ssh-login', (_, credentials) => {
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
