const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

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
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

ipcMain.on('notify-rental-created', (event, rental) => {
    console.log('📩 Новая аренда:', rental);
    
    try {
        const data = JSON.parse(fs.readFileSync(RENT_DATA_FILE, 'utf8'));
        data.rentals.push(rental);
        fs.writeFileSync(RENT_DATA_FILE, JSON.stringify(data, null, 2));
        console.log('✅ Данные аренды сохранены для бота');
    } catch (error) {
        console.error('❌ Ошибка сохранения данных аренды:', error);
    }
});

app.whenReady().then(() => {
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
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
        if (!url) return;
        try {
            await shell.openExternal(url);
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