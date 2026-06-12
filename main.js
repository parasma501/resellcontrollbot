const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let cachedSessionToken = '';

const DATA_DIR = path.join(__dirname, 'data');
const RENT_DATA_FILE = path.join(DATA_DIR, 'rent-data.json');

// Создаём директорию данных если нет
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Создаём файл rent-data.json если нет
if (!fs.existsSync(RENT_DATA_FILE)) {
    fs.writeFileSync(RENT_DATA_FILE, JSON.stringify({ rentals: [], lastNotification: {} }, null, 2));
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
            sandbox: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

ipcMain.on('notify-rental-created', (event, rental) => {
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
        const data = JSON.parse(fs.readFileSync(RENT_DATA_FILE, 'utf8'));
        data.rentals.push({ ...rental, propertyName, total });
        fs.writeFileSync(RENT_DATA_FILE, JSON.stringify(data, null, 2));
        console.log('✅ Данные аренды сохранены для бота');
    } catch (error) {
        console.error('❌ Ошибка сохранения данных аренды:', error);
    }
});

app.whenReady().then(() => {
    const sessionFile = path.join(app.getPath('userData'), 'subscription.session');

    ipcMain.handle('session:get', () => {
        if (cachedSessionToken) return cachedSessionToken;
        if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(sessionFile)) return '';
        try {
            cachedSessionToken = safeStorage.decryptString(fs.readFileSync(sessionFile));
            return cachedSessionToken;
        } catch {
            return '';
        }
    });

    ipcMain.handle('session:set', (event, token) => {
        if (typeof token !== 'string' || token.length < 40 || token.length > 4096 ||
            !safeStorage.isEncryptionAvailable()) {
            return false;
        }
        cachedSessionToken = token;
        fs.writeFileSync(sessionFile, safeStorage.encryptString(token));
        return true;
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
