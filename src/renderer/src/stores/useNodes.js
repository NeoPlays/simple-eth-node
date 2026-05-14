import { defineStore } from 'pinia'

export const useNodesStore = defineStore('nodes', {
    state: () => ({
        nodes: [],
        nodeCache: {},
    }),
    getters: {
        getAllNodes: (state) => state.nodes,
    },
    actions: {
        refreshNodes() {
            return window.api.invoke('get-all-nodes').then((data) => {
                this.nodes = data
            }).catch((error) => {
                console.error('Error fetching nodes:', error)
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
        _fetchNode(nodeId) {
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
