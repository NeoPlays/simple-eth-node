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
        nodeManager.addNode(node);
        return node.sshService.connect().then((data) => {
            return data;
        }).catch((error) => {
            log.error('SSH login error:', error);
            return {code: 1, message: 'SSH login error', error: error};
        });
    });

    ipcMain.handle('get-all-nodes', () => {
        return nodeManager.getAllNodes()
    });

    ipcMain.handle('get-node', (_, nodeId) => {
        return nodeManager.getNode(nodeId);
    });

    ipcMain.handle('disconnect-node', (_, nodeId) => {
        nodeManager.disconnectNode(nodeId)
    });
}
