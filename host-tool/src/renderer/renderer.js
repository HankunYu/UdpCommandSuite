(() => {
    const form = document.getElementById('commandForm');
    const listenPortInput = document.getElementById('listenPort');
    const setListenPortButton = document.getElementById('setListenPort');
    const listenStatus = document.getElementById('listenStatus');
    const selectionSummary = document.getElementById('selectionSummary');
    const hostInput = document.getElementById('targetHost');
    const portInput = document.getElementById('targetPort');
    const actionInput = document.getElementById('action');
    const payloadInput = document.getElementById('payload');
    const sharedSecretInput = document.getElementById('sharedSecret');
    const includeCmdIdInput = document.getElementById('includeCmdId');
    const cmdIdInput = document.getElementById('cmdId');
    const generateCmdIdButton = document.getElementById('generateCmdId');
    const timestampInput = document.getElementById('timestamp');
    const setNowButton = document.getElementById('setNow');
    const basicTabButton = document.getElementById('tabBasic');
    const advancedTabButton = document.getElementById('tabAdvanced');
    const basicCommandPanel = document.getElementById('basicCommandPanel');
    const advancedCommandPanel = document.getElementById('advancedCommandPanel');
    const autoTimestampInput = document.getElementById('autoTimestamp');
    const preview = document.getElementById('preview');
    const status = document.getElementById('status');
    const logContainer = document.getElementById('log');
    const deviceGrid = document.getElementById('deviceGrid');
    const deviceStats = document.getElementById('deviceStats');
    const selectAllButton = document.getElementById('selectAllDevices');
    const clearSelectionButton = document.getElementById('clearSelection');

    const clients = new Map();
    const selectedDevices = new Set();
    const CUSTOM_NAME_STORAGE_KEY = 'udpHost.customDeviceNames';
    const customDeviceNames = loadCustomDeviceNames();
    let discoveredHost = null;
    let currentListenMessage = '准备中...';
    let listenHasError = false;

    const DEFAULT_LISTEN_PORT = 4949;
    const MAX_LOG_ENTRIES = 200;
    const HEARTBEAT_TIMEOUT_MS = 10_000;
    const HEARTBEAT_TIMEOUT_SECONDS = HEARTBEAT_TIMEOUT_MS / 1000;
    const CMD_ID_MODE_AUTO = 'auto';
    const CMD_ID_MODE_MANUAL = 'manual';

    function loadCustomDeviceNames() {
        const fallback = Object.create(null);
        if (!window.localStorage) {
            return fallback;
        }

        try {
            const raw = window.localStorage.getItem(CUSTOM_NAME_STORAGE_KEY);
            if (!raw) {
                return fallback;
            }

            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return Object.assign(Object.create(null), parsed);
            }
        } catch {
            // ignore storage read errors
        }

        return fallback;
    }

    function saveCustomDeviceNames() {
        if (!window.localStorage) {
            return;
        }

        try {
            window.localStorage.setItem(CUSTOM_NAME_STORAGE_KEY, JSON.stringify(customDeviceNames));
        } catch {
            // ignore storage write errors
        }
    }

    function getStoredCustomName(key) {
        const value = customDeviceNames[key];
        return typeof value === 'string' && value.trim().length > 0
            ? value.trim()
            : '';
    }

    function setStoredCustomName(key, name) {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (trimmed) {
            customDeviceNames[key] = trimmed;
        } else {
            delete customDeviceNames[key];
        }

        saveCustomDeviceNames();
    }

    function getDeviceDisplayName(key, device) {
        const stored = getStoredCustomName(key);
        if (stored) {
            return stored;
        }

        if (device?.deviceName) {
            return device.deviceName;
        }

        if (device?.deviceId) {
            return device.deviceId;
        }

        if (device?.ipv4) {
            return device.ipv4;
        }

        return '未知设备';
    }

    function normalizeBatteryLevel(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    function normalizeBatteryStatus(value) {
        if (typeof value === 'string') {
            return value.trim();
        }

        return '';
    }

    function formatBattery(device) {
        const levelRaw = normalizeBatteryLevel(device?.batteryLevelPercent);
        const status = normalizeBatteryStatus(device?.batteryStatus);
        const hasLevel = Number.isFinite(levelRaw) && levelRaw >= 0;
        let levelText = '';

        if (hasLevel) {
            const rounded = Math.round(levelRaw * 10) / 10;
            levelText = Number.isInteger(rounded)
                ? `${rounded}%`
                : `${rounded.toFixed(1)}%`;
        }

        const parts = [];
        if (levelText) {
            parts.push(levelText);
        }
        if (status) {
            parts.push(status);
        }

        return parts.join(' · ');
    }

    async function sendBeepCommandForDevice(key) {
        if (!window.udpHost?.sendCommand) {
            status.textContent = 'Beep 功能不可用：缺少 udpHost 接口。';
            return;
        }

        const device = clients.get(key);
        if (!device) {
            status.textContent = '设备不存在或已离线。';
            return;
        }

        const host = (device.ipv4 || device.remoteAddress || '').trim();
        const deviceName = getDeviceDisplayName(key, device);

        if (!host) {
            status.textContent = `${deviceName} 缺少 IP，无法发送 Beep。`;
            appendLog('WARN', '缺少设备 IP，无法发送 Beep。', { name: deviceName });
            return;
        }

        const port = Number.isInteger(device.commandPort)
            ? device.commandPort
            : Number.parseInt(portInput.value, 10) || 3939;

        try {
            const result = await window.udpHost.sendCommand({
                action: 'beep',
                payload: '',
                includeCmdId: false,
                cmdId: '',
                sharedSecret: sharedSecretInput.value.trim(),
                timestamp: Date.now(),
                forcePayloadField: false,
                host,
                port,
            });

            appendLog('SEND', JSON.stringify(result.message, null, 2), { host, port, name: deviceName });
            status.textContent = `已向 ${deviceName} 发送 Beep。`;
        } catch (error) {
            const message = error?.message || String(error);
            status.textContent = `向 ${deviceName} 发送 Beep 失败：${message}`;
            appendLog('ERROR', message, { host, port, name: deviceName });
        }
    }

    function updateListenStatus(message, isError = false) {
        currentListenMessage = message;
        listenHasError = isError;
        refreshListenStatus();
    }

    function refreshListenStatus() {
        if (!listenStatus) {
            return;
        }

        let display = currentListenMessage || '';
        if (discoveredHost?.hostAddress) {
            const hostPort = discoveredHost.hostPort > 0 ? `:${discoveredHost.hostPort}` : '';
            const hostSummary = `Host ${discoveredHost.hostAddress}${hostPort}`;
            display = display ? `${display} • ${hostSummary}` : hostSummary;
        }

        listenStatus.textContent = display;
        listenStatus.classList.toggle('subtle', !listenHasError);
        listenStatus.style.color = listenHasError ? '#ff8a9f' : '';
    }

    function setCommandTab(tab) {
        if (!basicTabButton || !advancedTabButton || !basicCommandPanel || !advancedCommandPanel) {
            return;
        }

        const isBasic = tab === 'basic';
        basicTabButton.classList.toggle('active', isBasic);
        basicTabButton.setAttribute('aria-selected', String(isBasic));
        advancedTabButton.classList.toggle('active', !isBasic);
        advancedTabButton.setAttribute('aria-selected', String(!isBasic));
        basicCommandPanel.classList.toggle('active', isBasic);
        advancedCommandPanel.classList.toggle('active', !isBasic);
        basicCommandPanel.hidden = !isBasic;
        advancedCommandPanel.hidden = isBasic;
    }

    function randomShortId() {
        if (window.crypto?.randomUUID) {
            return window.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
        }

        return Math.random().toString(16).slice(2, 10);
    }

    function setCmdIdValue(value, mode = CMD_ID_MODE_AUTO) {
        if (!cmdIdInput) {
            return;
        }

        cmdIdInput.value = value;
        cmdIdInput.dataset.mode = mode;
    }

    function isCmdIdManual() {
        return cmdIdInput?.dataset.mode === CMD_ID_MODE_MANUAL;
    }

    function safeJsonParse(json) {
        if (typeof json !== 'string' || json.length === 0) {
            return null;
        }

        try {
            return JSON.parse(json);
        } catch {
            return null;
        }
    }

    function formatRelativeTime(timestamp) {
        if (!Number.isFinite(timestamp)) {
            return '未知';
        }

        const deltaSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
        if (deltaSeconds < 60) {
            return `${deltaSeconds}s 前`;
        }

        const deltaMinutes = Math.floor(deltaSeconds / 60);
        if (deltaMinutes < 60) {
            return `${deltaMinutes}m 前`;
        }

        const deltaHours = Math.floor(deltaMinutes / 60);
        if (deltaHours < 24) {
            return `${deltaHours}h 前`;
        }

        const deltaDays = Math.floor(deltaHours / 24);
        return `${deltaDays}d 前`;
    }

    function createDetail(label, value) {
        const row = document.createElement('span');
        const labelEl = document.createElement('strong');
        labelEl.textContent = label;
        const valueEl = document.createElement('span');
        valueEl.textContent = value || '—';
        row.append(labelEl, valueEl);
        return row;
    }

    function updateSelectionSummary() {
        if (!selectionSummary) {
            return;
        }

        const count = selectedDevices.size;
        selectionSummary.textContent = count > 0
            ? `目标：已选 ${count} 台设备`
            : '目标：手动指定';
    }

    function updateDeviceStats() {
        if (!deviceStats) {
            return;
        }

        const now = Date.now();
        let offlineCount = 0;
        clients.forEach((device) => {
            if (now - device.lastSeen > HEARTBEAT_TIMEOUT_MS) {
                offlineCount += 1;
            }
        });

        if (clients.size === 0) {
            deviceStats.textContent = '等待注册...';
        } else {
            const onlineCount = clients.size - offlineCount;
            const selectedCount = selectedDevices.size;
            const suffix = selectedCount > 0 ? `（已选 ${selectedCount}）` : '';
            deviceStats.textContent = `${onlineCount} 台在线 / ${offlineCount} 台离线${suffix}`;
        }

        if (selectAllButton) {
            const onlineCount = clients.size - offlineCount;
            selectAllButton.disabled = clients.size === 0 || selectedDevices.size >= onlineCount;
        }

        if (clearSelectionButton) {
            clearSelectionButton.disabled = selectedDevices.size === 0;
        }
    }

    function renderDeviceGrid() {
        if (!deviceGrid) {
            return;
        }

        const validKeys = new Set(clients.keys());
        for (const key of Array.from(selectedDevices)) {
            if (!validKeys.has(key)) {
                selectedDevices.delete(key);
            }
        }

        deviceGrid.innerHTML = '';

        if (clients.size === 0) {
            const placeholder = document.createElement('p');
            placeholder.className = 'placeholder';
            placeholder.textContent = '暂无设备上线。';
            deviceGrid.appendChild(placeholder);
            updateSelectionSummary();
            updateDeviceStats();
            return;
        }

        const now = Date.now();
        const ordered = Array.from(clients.entries())
            .map(([key, device]) => ({
                key,
                device,
                displayName: getDeviceDisplayName(key, device),
            }))
            .sort((a, b) => {
                const nameA = (a.displayName || '').toLowerCase();
                const nameB = (b.displayName || '').toLowerCase();
                if (nameA !== nameB) {
                    return nameA.localeCompare(nameB);
                }

                return (a.device.scene || '').localeCompare(b.device.scene || '');
            });

        ordered.forEach(({ key, device, displayName }) => {
            const isOffline = now - device.lastSeen > HEARTBEAT_TIMEOUT_MS;
            if (isOffline) {
                selectedDevices.delete(key);
            }

            const card = document.createElement('article');
            card.className = 'device-card';
            card.dataset.key = key;
            if (selectedDevices.has(key)) {
                card.classList.add('selected');
            }
            if (isOffline) {
                card.classList.add('offline');
            }

            const header = document.createElement('div');
            header.className = 'header';

            const nameGroup = document.createElement('div');
            nameGroup.className = 'name-group';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'name';
            nameInput.value = displayName;
            nameInput.readOnly = true;
            nameInput.spellcheck = false;
            nameInput.autocomplete = 'off';

            const renameButton = document.createElement('button');
            renameButton.type = 'button';
            renameButton.className = 'rename-button';
            renameButton.textContent = '重命名';
            renameButton.title = '设置自定义名称';

            function stopEditing(saveChanges) {
                if (nameInput.readOnly) {
                    return;
                }

                nameInput.readOnly = true;
                nameInput.classList.remove('editing');
                renameButton.textContent = '重命名';
                card.classList.remove('editing-name');

                if (!saveChanges) {
                    nameInput.value = getDeviceDisplayName(key, device);
                    return;
                }

                const trimmed = nameInput.value.trim();
                const stored = getStoredCustomName(key);
                const defaultName = device.deviceName || device.deviceId || '';
                const shouldClear = trimmed.length === 0 || trimmed === defaultName;
                if (shouldClear) {
                    if (stored) {
                        setStoredCustomName(key, '');
                        renderDeviceGrid();
                    } else {
                        nameInput.value = getDeviceDisplayName(key, device);
                    }
                    return;
                }

                if (trimmed !== stored) {
                    setStoredCustomName(key, trimmed);
                    renderDeviceGrid();
                } else {
                    nameInput.value = getDeviceDisplayName(key, device);
                }
            }

            renameButton.addEventListener('click', (event) => {
                event.stopPropagation();
                if (nameInput.readOnly) {
                    nameInput.readOnly = false;
                    nameInput.classList.add('editing');
                    card.classList.add('editing-name');
                    renameButton.textContent = '保存';
                    nameInput.focus();
                    nameInput.select();
                } else {
                    stopEditing(true);
                }
            });

            nameInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    stopEditing(true);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    stopEditing(false);
                }
            });

            nameInput.addEventListener('blur', () => {
                stopEditing(true);
            });

            nameInput.addEventListener('mousedown', (event) => {
                if (nameInput.readOnly) {
                    event.preventDefault();
                }
                event.stopPropagation();
            });

            nameInput.addEventListener('click', (event) => {
                event.stopPropagation();
            });

            nameGroup.append(nameInput, renameButton);

            const headerActions = document.createElement('div');
            headerActions.className = 'header-actions';

            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = isOffline ? '离线' : (device.scene || 'Idle');

            const beepButton = document.createElement('button');
            beepButton.type = 'button';
            beepButton.className = 'beep-button';
            beepButton.textContent = 'Beep';
            beepButton.title = '向设备发送 Beep';
            beepButton.disabled = isOffline;
            beepButton.addEventListener('click', (event) => {
                event.stopPropagation();
                if (isOffline) {
                    return;
                }

                void sendBeepCommandForDevice(key);
            });

            headerActions.append(badge, beepButton);
            header.append(nameGroup, headerActions);

            const lastSeen = document.createElement('p');
            lastSeen.className = 'muted';
            lastSeen.textContent = isOffline
                ? `最近通信：超过 ${HEARTBEAT_TIMEOUT_SECONDS}s 未响应`
                : `最近通信：${formatRelativeTime(device.lastSeen)}`;

            const details = document.createElement('div');
            details.className = 'details';
            details.append(
                createDetail('设备ID', device.deviceId),
                createDetail('IPv4', device.ipv4 || device.remoteAddress || '未知'),
                createDetail('命令端口', device.commandPort ? String(device.commandPort) : (portInput.value || '—')),
                createDetail('平台', device.platform || '—'),
                createDetail('版本', device.buildVersion || '—'),
                createDetail('电量', formatBattery(device))
            );

            const toggleButton = document.createElement('button');
            toggleButton.type = 'button';
            toggleButton.className = 'select-toggle';
            if (isOffline) {
                toggleButton.textContent = '离线';
                toggleButton.disabled = true;
            } else {
                toggleButton.textContent = selectedDevices.has(key) ? '取消选择' : '选择设备';
                toggleButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    toggleDeviceSelection(key);
                });
            }

            card.append(header, lastSeen, details, toggleButton);
            if (!isOffline) {
                card.addEventListener('click', (event) => {
                    if (event.target instanceof HTMLButtonElement) {
                        return;
                    }

                    toggleDeviceSelection(key);
                });
            }

            deviceGrid.appendChild(card);
        });

        updateSelectionSummary();
        updateDeviceStats();
    }

    function toggleDeviceSelection(key) {
        const device = clients.get(key);
        if (!device) {
            selectedDevices.delete(key);
            renderDeviceGrid();
            return;
        }

        if (Date.now() - device.lastSeen > HEARTBEAT_TIMEOUT_MS) {
            return;
        }

        if (selectedDevices.has(key)) {
            selectedDevices.delete(key);
        } else {
            selectedDevices.add(key);
        }

        renderDeviceGrid();
    }

    function selectAllDevices() {
        const now = Date.now();
        clients.forEach((device, key) => {
            if (now - device.lastSeen <= HEARTBEAT_TIMEOUT_MS) {
                selectedDevices.add(key);
            }
        });
        renderDeviceGrid();
    }

    function clearDeviceSelection() {
        if (selectedDevices.size === 0) {
            return;
        }

        selectedDevices.clear();
        renderDeviceGrid();
    }

    function updateCmdIdState() {
        const enabled = includeCmdIdInput.checked;
        cmdIdInput.disabled = !enabled;
        generateCmdIdButton.disabled = !enabled;

        if (enabled && !isCmdIdManual()) {
            setCmdIdValue(cmdIdInput.value || randomShortId(), CMD_ID_MODE_AUTO);
        }

        if (!enabled) {
            status.textContent = '';
        }
    }

    function updateTimestampState() {
        if (!timestampInput) {
            return;
        }

        const autoEnabled = Boolean(autoTimestampInput?.checked);
        timestampInput.disabled = autoEnabled;

        if (setNowButton) {
            setNowButton.disabled = autoEnabled;
        }

        if (autoEnabled) {
            timestampInput.value = Date.now();
        }

        buildPreview();
    }

    function appendLog(kind, content, meta = {}) {
        if (!logContainer) {
            return;
        }

        const entry = document.createElement('div');
        entry.className = 'log-entry';

        const metaRow = document.createElement('div');
        metaRow.className = 'meta';
        const parts = [`${new Date().toLocaleTimeString()} · ${kind}`];

        if (meta.name) {
            parts.push(meta.name);
        }

        if (meta.host) {
            parts.push(`${meta.host}${meta.port ? `:${meta.port}` : ''}`);
        }

        metaRow.textContent = parts.join(' · ');

        const payload = document.createElement('pre');
        payload.className = 'payload';
        payload.textContent = content;

        entry.append(metaRow, payload);
        logContainer.prepend(entry);

        while (logContainer.childElementCount > MAX_LOG_ENTRIES) {
            logContainer.removeChild(logContainer.lastChild);
        }
    }

    function buildPreview() {
        const action = actionInput.value.trim();
        const includeCmdId = includeCmdIdInput.checked;
        const providedCmdId = cmdIdInput.value.trim();
        const timestampValue = Number.parseInt(timestampInput.value, 10);
        const timestamp = Number.isFinite(timestampValue) ? timestampValue : Date.now();
        const payloadRaw = payloadInput.value.trim();
        const message = {
            action: action || '(unset)',
            timestamp,
        };

        let payloadError = null;
        let payloadString = '';

        if (payloadRaw.length > 0) {
            try {
                const parsed = JSON.parse(payloadRaw);
                payloadString = JSON.stringify(parsed);
                message.payload = payloadString;
                payloadInput.classList.remove('invalid');
            } catch (error) {
                payloadError = error;
                payloadInput.classList.add('invalid');
            }
        } else {
            payloadInput.classList.remove('invalid');
        }

        if (includeCmdId) {
            message.cmdId = providedCmdId || '(auto)';
        }

        if (sharedSecretInput.value.trim()) {
            message.signature = '(computed)';
        }

        if (payloadError) {
            preview.textContent = `Payload 必须是合法 JSON。\n${payloadError.message}`;
        } else {
            preview.textContent = JSON.stringify(message, null, 2);
        }

        return {
            payloadError,
            payloadString,
            timestamp,
        };
    }

    function onFormChanged() {
        buildPreview();
    }

    function processInboundPacket(packet) {
        const message = safeJsonParse(packet.payload);
        const meta = { host: packet.address, port: packet.port };

        if (!message) {
            appendLog('RECV', packet.payload, meta);
            return;
        }

        const action = String(message.action ?? '').toLowerCase();
        const payload = safeJsonParse(message.payload);
        const label = action === 'hostannouncement' ? 'HOST' : 'RECV';
        appendLog(label, JSON.stringify(message, null, 2), meta);

        if (action === 'hostannouncement') {
            applyHostAnnouncement(payload);
            return;
        }

        if (!payload) {
            return;
        }

        if (action === 'registerclient' || action === 'heartbeat') {
            upsertClient(packet, {
                deviceId: payload.deviceId ?? payload.deviceID,
                deviceName: payload.deviceName,
                platform: payload.platform,
                buildVersion: payload.buildVersion,
                ipv4: payload.ipv4,
                scene: payload.scene,
                commandPort: Number.isInteger(payload.commandPort) ? payload.commandPort : undefined,
                batteryLevelPercent: normalizeBatteryLevel(payload.batteryLevelPercent),
                batteryStatus: normalizeBatteryStatus(payload.batteryStatus),
            });
        }
    }

    function upsertClient(packet, payload) {
        const key = payload?.deviceId || packet.address || `client-${clients.size + 1}`;
        const now = Date.now();
        const current = clients.get(key) || {
            deviceId: payload?.deviceId || key,
            deviceName: payload?.deviceName || '',
            platform: payload?.platform || '',
            buildVersion: payload?.buildVersion || '',
            ipv4: payload?.ipv4 || packet.address,
            scene: payload?.scene || '',
            commandPort: payload?.commandPort,
            batteryLevelPercent: payload?.batteryLevelPercent,
            batteryStatus: payload?.batteryStatus,
            remoteAddress: packet.address,
            remotePort: packet.port,
            firstSeen: now,
            lastSeen: now,
        };

        const updated = {
            ...current,
            remoteAddress: packet.address,
            remotePort: packet.port,
            lastSeen: now,
        };

        Object.entries(payload ?? {}).forEach(([prop, value]) => {
            if (value !== undefined && value !== null) {
                updated[prop] = value;
            }
        });

        updated.ipv4 = updated.ipv4 || packet.address;
        updated.scene = updated.scene || current.scene;
        updated.commandPort = updated.commandPort || Number.parseInt(portInput.value, 10) || 3939;

        if (!updated.deviceName) {
            updated.deviceName = updated.deviceId;
        }

        clients.set(key, updated);
        renderDeviceGrid();
    }

    function applyHostAnnouncement(payload) {
        if (!payload) {
            return;
        }

        discoveredHost = {
            hostAddress: typeof payload.hostAddress === 'string' ? payload.hostAddress : '',
            hostName: typeof payload.hostName === 'string' ? payload.hostName : '',
            hostPort: Number.isInteger(payload.hostPort) ? payload.hostPort : discoveredHost?.hostPort ?? 0,
            commandPort: Number.isInteger(payload.commandPort) ? payload.commandPort : discoveredHost?.commandPort ?? 0,
        };

        if (discoveredHost.hostAddress) {
            hostInput.value = discoveredHost.hostAddress;
        }

        if (discoveredHost.commandPort > 0) {
            portInput.value = discoveredHost.commandPort;
        }

        refreshListenStatus();
    }

    async function applyListenPort(value) {
        if (!window.udpHost?.setListenPort) {
            updateListenStatus('监听器配置不可用。', true);
            return;
        }

        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
            updateListenStatus('端口需在 0~65535 范围内。', true);
            return;
        }

        updateListenStatus('绑定中...');

        try {
            const info = await window.udpHost.setListenPort(parsed);
            listenPortInput.value = info.port;
            updateListenStatus(`监听端口 ${info.port}`);
        } catch (error) {
            updateListenStatus(`绑定失败：${error.message}`, true);
        }
    }

    includeCmdIdInput.addEventListener('change', () => {
        updateCmdIdState();
        buildPreview();
    });

    if (cmdIdInput) {
        cmdIdInput.addEventListener('input', () => {
            cmdIdInput.dataset.mode = CMD_ID_MODE_MANUAL;
        });
    }

    if (autoTimestampInput) {
        autoTimestampInput.addEventListener('change', () => {
            updateTimestampState();
        });
    }

    if (basicTabButton && advancedTabButton) {
        basicTabButton.addEventListener('click', () => setCommandTab('basic'));
        advancedTabButton.addEventListener('click', () => setCommandTab('advanced'));
    }

    [hostInput, portInput, actionInput, payloadInput, sharedSecretInput, cmdIdInput, timestampInput]
        .forEach((input) => input.addEventListener('input', onFormChanged));

    generateCmdIdButton.addEventListener('click', () => {
        setCmdIdValue(randomShortId(), CMD_ID_MODE_AUTO);
        buildPreview();
    });

    setNowButton.addEventListener('click', () => {
        timestampInput.value = Date.now();
        buildPreview();
    });

    if (selectAllButton) {
        selectAllButton.addEventListener('click', selectAllDevices);
    }

    if (clearSelectionButton) {
        clearSelectionButton.addEventListener('click', clearDeviceSelection);
    }

    setListenPortButton.addEventListener('click', () => {
        applyListenPort(listenPortInput.value);
    });

    listenPortInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            applyListenPort(listenPortInput.value);
        }
    });

    setCommandTab('basic');
    timestampInput.value = Date.now();
    if (!cmdIdInput.value) {
        setCmdIdValue(randomShortId(), CMD_ID_MODE_AUTO);
    } else if (!cmdIdInput.dataset.mode) {
        cmdIdInput.dataset.mode = CMD_ID_MODE_AUTO;
    }
    updateCmdIdState();
    updateTimestampState();
    renderDeviceGrid();
    updateListenStatus('绑定中...');
    applyListenPort(DEFAULT_LISTEN_PORT);
    setInterval(renderDeviceGrid, 15000);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        status.textContent = '';

        const action = actionInput.value.trim();
        const includeCmdId = includeCmdIdInput.checked;
        const sharedSecret = sharedSecretInput.value.trim();
        if (autoTimestampInput?.checked) {
            timestampInput.value = Date.now();
        }
        if (includeCmdId && !isCmdIdManual()) {
            setCmdIdValue(randomShortId(), CMD_ID_MODE_AUTO);
        }
        const previewState = buildPreview();
        const cmdId = cmdIdInput.value.trim();
        const selectedTargets = Array.from(selectedDevices)
            .map((key) => ({ key, device: clients.get(key) }))
            .filter((entry) => Boolean(entry.device));

        if (previewState.payloadError) {
            status.textContent = '请先修复 Payload JSON。';
            return;
        }

        if (!action) {
            status.textContent = 'Action 不能为空。';
            actionInput.focus();
            return;
        }

        const port = Number.parseInt(portInput.value, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            status.textContent = '命令端口需在 1~65535 范围内。';
            portInput.focus();
            return;
        }

        const requestTemplate = {
            action,
            payload: previewState.payloadString,
            includeCmdId,
            cmdId,
            sharedSecret,
            timestamp: previewState.timestamp,
            forcePayloadField: payloadInput.value.trim().length > 0,
        };

        if (selectedTargets.length > 0) {
            let successCount = 0;
            const failures = [];

            for (const { key, device } of selectedTargets) {
                const host = (device.ipv4 || device.remoteAddress || '').trim();
                const devicePort = Number.isInteger(device.commandPort) ? device.commandPort : port;
                const deviceName = getDeviceDisplayName(key, device) || host || '未知设备';

                if (!host) {
                    const message = `${deviceName}：缺少 IP，已跳过。`;
                    failures.push(message);
                    appendLog('WARN', message, { name: deviceName });
                    continue;
                }

                try {
                    const result = await window.udpHost.sendCommand({
                        ...requestTemplate,
                        host,
                        port: devicePort,
                    });

                    successCount += 1;
                    appendLog(
                        'SEND',
                        JSON.stringify(result.message, null, 2),
                        { host, port: devicePort, name: deviceName }
                    );
                } catch (error) {
                    const failureMessage = `${deviceName}：${error.message}`;
                    failures.push(failureMessage);
                    appendLog('ERROR', error.message, { host, port: devicePort, name: deviceName });
                }
            }

            if (failures.length > 0) {
                status.textContent = `${successCount} 台成功，${failures.length} 台失败。`;
                console.warn('Command failures', failures);
            } else {
                status.textContent = `已向 ${successCount} 台设备发送命令。`;
            }
        } else {
            const host = hostInput.value.trim();
            if (!host) {
                status.textContent = '请先选择设备或填写目标主机。';
                hostInput.focus();
                return;
            }

            try {
                const result = await window.udpHost.sendCommand({
                    ...requestTemplate,
                    host,
                    port,
                });

                status.textContent = `发送成功（${result.sentBytes} bytes）。`;
                appendLog('SEND', JSON.stringify(result.message, null, 2), { host, port });
            } catch (error) {
                status.textContent = `发送失败：${error.message}`;
                appendLog('ERROR', error.message);
            }
        }
    });

    if (window.udpHost?.onServerStatus) {
        window.udpHost.onServerStatus((info) => {
            if (info?.port !== undefined) {
                listenPortInput.value = info.port;
                updateListenStatus(`监听端口 ${info.port}`);
            }
        });
    }

    if (window.udpHost?.onServerClosed) {
        window.udpHost.onServerClosed(() => {
            updateListenStatus('监听器已关闭，请重新绑定端口。', true);
        });
    }

    if (window.udpHost?.onMessage) {
        window.udpHost.onMessage((packet) => {
            if (!packet) {
                return;
            }

            processInboundPacket(packet);
        });
    }

    if (window.udpHost?.onAcknowledgement) {
        window.udpHost.onAcknowledgement((ack) => {
            try {
                const parsed = JSON.parse(ack.payload);
                appendLog('ACK', JSON.stringify(parsed, null, 2), { host: ack.address, port: ack.port });
            } catch {
                appendLog('ACK', ack.payload, { host: ack.address, port: ack.port });
            }
        });
    }

    if (window.udpHost?.onError) {
        window.udpHost.onError((message) => {
            updateListenStatus(`Socket 错误：${message}`, true);
            appendLog('SOCKET', message);
        });
    }
})();
