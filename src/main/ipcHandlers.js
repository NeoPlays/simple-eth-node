import { ipcMain } from "electron";
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

    ipcMain.handle('disconnect-node', async (_, nodeId) => {
        try {
            nodeManager.disconnectNode(nodeId)
        } catch (error) {
            log.error('disconnect-node error:', error);
        }
    });
}
