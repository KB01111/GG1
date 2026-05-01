const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '../..');
const environment = process.env.TEST_UNPACKED ? 'production' : 'development';
const pkg = require('../../package.json');

const distExecPath = {
  win32: path.resolve(root, 'dist/win-unpacked', `${pkg.productName}.exe`),
  linux: path.resolve(root, 'dist/linux-unpacked', pkg.name),
  darwin: path.resolve(root, 'dist/mac', `${pkg.productName}.app`)
}[process.platform];

let electronApp;
let viteProcess;

async function waitForVite() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    try {
      const response = await fetch('http://127.0.0.1:5173');
      if (response.ok) return;
    } catch (error) {
      void error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Vite dev server did not start');
}

const utils = (page) => ({
  click: async (selector) => page.click(selector),
  getText: async (selector) => page.locator(selector).innerText(),
  waitForVisible: async (selector) => page.locator(selector).waitFor({ state: 'visible', timeout: 15000 }),
  waitForElementCount: async (selector, count = 1) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      if (await page.locator(selector).count() === count) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`expected ${count} of element "${selector}"`);
  }
});

module.exports = {
  environment,
  start: async () => {
    const launchOptions = {
      cwd: root,
      env: {
        ...process.env
      }
    };

    if (environment === 'production') {
      launchOptions.executablePath = fs.existsSync(distExecPath) ? distExecPath : undefined;
    } else {
      viteProcess = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'], {
        cwd: root,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      await waitForVite();
      launchOptions.args = ['.'];
      launchOptions.env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173';
    }

    electronApp = await electron.launch(launchOptions);
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    return { page, browser: electronApp, utils: utils(page) };
  },
  stop: async () => {
    if (electronApp) {
      await electronApp.close();
      electronApp = undefined;
    }
    if (viteProcess) {
      viteProcess.kill();
      viteProcess = undefined;
    }
  }
};
