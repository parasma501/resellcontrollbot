const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let cachedSessionToken = '';
let rentDataFile = '';

function isValidSessionToken(token) {
    return typeof token === 'string' && token.length >= 40 && token.length <= 4096;
}

function initDataFiles() {
    const dataDir = path.join(app.getPath('userData'), 'data');
    rentDataFile = path.join(dataDir, 'rent-data.json');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(rentDataFile)) {
        fs.writeFileSync(rentDataFile, JSON.stringify({ rentals: [], lastNotification: {} }, null, 2));
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 1000,
        minHeight: 700,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#0f1115',
        icon: path.join(__dirname, 'build', 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            additionalArguments: [`--app-version=${app.getVersion()}`]
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function saveRentalForLocalBot(rental) {
    if (!rental || typeof rental !== 'object') return;
    const propertyName = typeof rental.propertyName === 'string' ? rental.propertyName.trim() : '';
    const start = Date.parse(rental.start);
    const end = Date.parse(rental.end);
    const total = Number(rental.total);
    if (!propertyName || propertyName.length > 100 || !Number.isFinite(start) ||
        !Number.isFinite(end) || end < start || !Number.isFinite(total) ||
        total < 0 || total > 1000000000) {
        return;
    }
    try {
        const data = JSON.parse(fs.readFileSync(rentDataFile, 'utf8'));
        data.rentals.push({ ...rental, propertyName, total });
        fs.writeFileSync(rentDataFile, JSON.stringify(data, null, 2));
        console.log('Rental data saved for the local bot');
    } catch (error) {
        console.error('Failed to save rental data:', error);
    }
}

app.whenReady().then(() => {
    initDataFiles();
    const sessionFile = path.join(app.getPath('userData'), 'subscription.session');

    ipcMain.on('notify-rental-created', (event, rental) => saveRentalForLocalBot(rental));

    ipcMain.handle('session:get', () => {
        if (cachedSessionToken) return cachedSessionToken;
        if (!fs.existsSync(sessionFile)) return '';
        try {
            const stored = fs.readFileSync(sessionFile);
            try {
                const parsed = JSON.parse(stored.toString('utf8'));
                if (parsed.storage === 'plain' && isValidSessionToken(parsed.token)) {
                    cachedSessionToken = parsed.token;
                    return cachedSessionToken;
                }
            } catch {
                // Not a plain fallback file; try Electron safeStorage below.
            }
            if (!safeStorage.isEncryptionAvailable()) return '';
            cachedSessionToken = safeStorage.decryptString(stored);
            return isValidSessionToken(cachedSessionToken) ? cachedSessionToken : '';
        } catch {
            return '';
        }
    });

    ipcMain.handle('session:set', (event, token) => {
        if (!isValidSessionToken(token)) return false;
        cachedSessionToken = token;
        try {
            if (safeStorage.isEncryptionAvailable()) {
                fs.writeFileSync(sessionFile, safeStorage.encryptString(token));
            } else {
                fs.writeFileSync(sessionFile, JSON.stringify({ storage: 'plain', token }));
            }
            return true;
        } catch (error) {
            cachedSessionToken = '';
            console.error('Failed to save subscription session:', error);
            return false;
        }
    });

    ipcMain.handle('session:clear', () => {
        cachedSessionToken = '';
        if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
        return true;
    });

    createWindow();

    ipcMain.on('window:minimize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.minimize();
    });

    ipcMain.on('window:close', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.close();
    });

    ipcMain.on('open-external', async (event, url) => {
        if (typeof url !== 'string') return;
        try {
            const parsed = new URL(url);
            const allowedHosts = new Set(['discord.gg', 'github.com', 't.me']);
            if (parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname)) {
                await shell.openExternal(parsed.toString());
            }
        } catch (error) {
            console.error('Failed to open external URL:', error);
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
