export class NodeManager {
    constructor() {
        this.nodes = []
    }

    addNode(node) {
        this.nodes.push(node)
    }

    removeNode(nodeId) {
        this.nodes = this.nodes.filter(node => node.id !== nodeId)
    }

    disconnectNode(nodeId) {
        const node = this.nodes.find(node => node.id === nodeId)
        if (node) node.disconnect()
        this.removeNode(nodeId)
    }

    findNode(nodeId) {
        return this.nodes.find(node => node.id === nodeId) ?? null
    }

    getNode(nodeId) {
        const node = this.findNode(nodeId)
        return node ? node.toDTO() : null
    }

    getAllNodes() {
        return this.nodes.map(node => node.toListDTO())
    }
}

const nodeManager = new NodeManager()

export default nodeManager;