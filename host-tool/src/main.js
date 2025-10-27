const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const dgram = require('node:dgram');
const os = require('node:os');
const { randomUUID, createHmac } = require('node:crypto');

let mainWindow = null;
let udpSocket = null;
let listenPort = 4949;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 960,
        height: 760,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch((error) => {
        dialog.showErrorBox('Failed to load UI', error.message);
    });
}

async function ensureSocket(port = listenPort) {
    if (udpSocket) {
        const bound = udpSocket.address();
        if (bound && bound.port === port) {
            return udpSocket;
        }

        await closeSocket(udpSocket);
    }

    return createSocket(port);
}

function closeSocket(socket) {
    return new Promise((resolve) => {
        if (!socket) {
            resolve();
            return;
        }

        const handleClose = () => {
            socket.removeListener('close', handleClose);
            resolve();
        };

        socket.once('close', handleClose);
        socket.close();
    });
}

function createSocket(port) {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');

        const initialError = (error) => {
            socket.removeListener('listening', handleListening);
            socket.close();
            reject(error);
        };

        const handleListening = () => {
            socket.removeListener('error', initialError);
            configureSocket(socket);
            resolve(socket);
        };

        socket.once('error', initialError);
        socket.once('listening', handleListening);
        socket.bind(port);
    });
}

function configureSocket(socket) {
    udpSocket = socket;

    try {
        socket.setBroadcast(true);
    } catch (error) {
        mainWindow?.webContents.send('udp:error', `Broadcast configuration failed: ${error.message}`);
    }

    socket.on('error', (error) => {
        mainWindow?.webContents.send('udp:error', error.message);
    });

    socket.on('close', () => {
        if (udpSocket === socket) {
            udpSocket = null;
        }
        mainWindow?.webContents.send('udp:server-closed');
    });

    socket.on('message', (message, remote) => {
        const payload = message.toString('utf8');
        const packet = {
            address: remote.address,
            port: remote.port,
            payload,
        };

        mainWindow?.webContents.send('udp:message', packet);
        mainWindow?.webContents.send('udp:ack', packet);

        const parsed = safeParseJson(payload);
        if (parsed) {
            handleHostDiscovery(socket, parsed, remote);
        }
    });

    const addressInfo = socket.address();
    listenPort = addressInfo.port;
    mainWindow?.webContents.send('udp:server-listening', {
        address: addressInfo.address,
        port: addressInfo.port,
    });
}

ipcMain.handle('udp:send', async (_event, request) => {
    if (!request || typeof request !== 'object') {
        throw new Error('Invalid request payload.');
    }

    const targetHost = String(request.host ?? '').trim();
    const port = Number.parseInt(request.port, 10);
    const action = String(request.action ?? '').trim();
    const includeCmdId = Boolean(request.includeCmdId);
    const explicitCmdId = typeof request.cmdId === 'string' ? request.cmdId.trim() : '';
    const sharedSecret = typeof request.sharedSecret === 'string' ? request.sharedSecret : '';

    if (!targetHost) {
        throw new Error('Target host is required.');
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Port must be between 1 and 65535.');
    }

    if (!action) {
        throw new Error('Action is required.');
    }

    const timestamp = Number.isFinite(request.timestamp)
        ? Math.trunc(request.timestamp)
        : Date.now();

    const payloadString = typeof request.payload === 'string' ? request.payload : '';

    const message = {
        action,
        timestamp,
    };

    if (payloadString.length > 0 || request.forcePayloadField) {
        message.payload = payloadString;
    }

    if (includeCmdId) {
        message.cmdId = explicitCmdId || randomUUID().slice(0, 8);
    }

    if (sharedSecret) {
        const canonical = `${message.action}|${message.payload ?? ''}|${message.timestamp}`;
        const hmac = createHmac('sha256', sharedSecret);
        message.signature = hmac.update(canonical).digest('base64');
    }

    const socket = await ensureSocket(listenPort);
    const buffer = Buffer.from(JSON.stringify(message), 'utf8');

    await new Promise((resolve, reject) => {
        socket.send(buffer, 0, buffer.length, port, targetHost, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });

    return {
        sentBytes: buffer.length,
        message,
    };
});

ipcMain.handle('udp:set-listen-port', async (_event, portRequest) => {
    const parsed = Number.parseInt(portRequest, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new Error('Listen port must be between 0 and 65535.');
    }

    const socket = await ensureSocket(parsed);
    return socket.address();
});

app.whenReady().then(() => {
    createWindow();

    ensureSocket(listenPort).catch((error) => {
        mainWindow?.webContents.send('udp:error', `Listener failed: ${error.message}`);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    if (udpSocket) {
        const socket = udpSocket;
        udpSocket = null;
        try {
            socket.close();
        } catch {
            // ignore shutdown errors
        }
    }
});

function safeParseJson(payload) {
    if (typeof payload !== 'string' || payload.length === 0) {
        return null;
    }

    try {
        return JSON.parse(payload);
    } catch {
        return null;
    }
}

function handleHostDiscovery(socket, message, remote) {
    const action = typeof message.action === 'string' ? message.action.toLowerCase() : '';
    if (action !== 'discoverhost') {
        return;
    }

    let requestPayload = null;
    if (typeof message.payload === 'string' && message.payload.length > 0) {
        requestPayload = safeParseJson(message.payload);
    }

    const addressInfo = socket.address();
    const hostAddress = resolveLocalIPv4(remote.address) || addressInfo.address || '0.0.0.0';
    const requestedCommandPort = Number.parseInt(requestPayload?.commandPort, 10);
    const response = {
        action: 'HostAnnouncement',
        timestamp: Date.now(),
        payload: JSON.stringify({
            hostName: os.hostname(),
            hostAddress,
            hostPort: addressInfo.port,
            commandPort: Number.isInteger(requestedCommandPort) ? requestedCommandPort : 0,
        }),
    };

    if (typeof message.cmdId === 'string' && message.cmdId.length > 0) {
        response.cmdId = message.cmdId;
    }

    const buffer = Buffer.from(JSON.stringify(response), 'utf8');
    socket.send(buffer, 0, buffer.length, remote.port, remote.address, (error) => {
        if (error) {
            mainWindow?.webContents.send('udp:error', `Discovery response failed: ${error.message}`);
        }
    });
}

function resolveLocalIPv4(remoteAddress) {
    const interfaces = os.networkInterfaces();
    const remoteParts = typeof remoteAddress === 'string' ? remoteAddress.split('.') : null;
    let fallback = null;

    for (const addresses of Object.values(interfaces)) {
        for (const details of addresses ?? []) {
            if (!details || details.internal || details.family !== 'IPv4') {
                continue;
            }

            fallback ??= details.address;

            if (!remoteParts || remoteParts.length !== 4) {
                continue;
            }

            const localParts = details.address.split('.');
            if (localParts.length !== 4) {
                continue;
            }

            if (localParts[0] === remoteParts[0] &&
                localParts[1] === remoteParts[1] &&
                localParts[2] === remoteParts[2]) {
                return details.address;
            }
        }
    }

    return fallback;
}
