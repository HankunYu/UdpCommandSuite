const { contextBridge, ipcRenderer } = require('electron');

function wrapListener(channel) {
    return (callback) => {
        if (typeof callback !== 'function') {
            return () => {};
        }

        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on(channel, listener);

        return () => {
            ipcRenderer.removeListener(channel, listener);
        };
    };
}

contextBridge.exposeInMainWorld('udpHost', {
    sendCommand(request) {
        return ipcRenderer.invoke('udp:send', request);
    },
    setListenPort(port) {
        return ipcRenderer.invoke('udp:set-listen-port', port);
    },
    onServerStatus: wrapListener('udp:server-listening'),
    onServerClosed: wrapListener('udp:server-closed'),
    onMessage: wrapListener('udp:message'),
    onAcknowledgement: wrapListener('udp:ack'),
    onError: wrapListener('udp:error'),
});
