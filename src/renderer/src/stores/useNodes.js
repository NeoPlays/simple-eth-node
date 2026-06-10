import { defineStore } from 'pinia'

export const useNodesStore = defineStore('nodes', {
    state: () => ({
        nodes: [],
        nodeCache: {},
        _statusSubscribed: false,
    }),
    getters: {
        getAllNodes: (state) => state.nodes,
    },
    actions: {
        _subscribeStatus() {
            if (this._statusSubscribed) return
            this._statusSubscribed = true
            window.api.on('node-status-changed', ({ id, status }) => {
                const node = this.nodes.find(n => n.id === id)
                if (node) {
                    node.status = status
                    node.connected = status === 'connected'
                }
                if (this.nodeCache[id]) {
                    this.nodeCache[id].status = status
                    if (status === 'disconnected') delete this.nodeCache[id]
                }
            })
        },
        refreshNodes() {
            this._subscribeStatus()
            return window.api.invoke('get-all-nodes').then((data) => {
                this.nodes = data
            }).catch((error) => {
                console.error('Error fetching nodes:', error)
            })
        },
        isDisconnected(nodeId) {
            const node = this.nodes.find(n => n.id === nodeId)
            return node ? node.status === 'disconnected' : false
        },
        reconnectNode(nodeId) {
            return window.api.invoke('reconnect-node', nodeId).catch((error) => {
                console.error('Error reconnecting node:', error)
                return false
            })
        },
        getNode(nodeId) {
            if (this.nodeCache[nodeId]) {
                return Promise.resolve(this.nodeCache[nodeId])
            }
            return this._fetchNode(nodeId)
        },
        refreshNode(nodeId) {
            return this._fetchNode(nodeId)
        },
        async _fetchNode(nodeId) {
            if (this.isDisconnected(nodeId)) {
                const ok = await this.reconnectNode(nodeId)
                if (!ok) return null
            }
            return window.api.invoke('get-node', nodeId).then((data) => {
                if (data) this.nodeCache[nodeId] = data
                return data
            }).catch((error) => {
                console.error('Error fetching node by ID:', error)
                return null
            })
        },
        disconnectNode(nodeId) {
            return window.api.invoke('disconnect-node', nodeId).then(() => {
                delete this.nodeCache[nodeId]
                this.nodes = this.nodes.filter(n => n.id !== nodeId)
            }).catch((error) => {
                console.error('Error disconnecting node:', error)
            })
        },
    },
})
