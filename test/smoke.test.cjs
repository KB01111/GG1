const { expect } = require('chai');
const { start, stop } = require('./lib/app-provider.cjs');

describe('[smoke tests]', () => {
  afterEach(async () => {
    await stop();
  });

  it('opens the storage cleaner dashboard', async () => {
    const app = await start();

    await app.utils.waitForVisible('main.shell');
    expect(await app.utils.getText('h1')).to.include('AI Storage Cleaner');
  });

  it('shows safety-first scan and Drive sections', async () => {
    const app = await start();

    await app.utils.waitForVisible('[data-testid="dashboard-metrics"]');
    expect((await app.utils.getText('body')).toLowerCase()).to.include('dry-run first windows storage cleanup');
    expect(await app.utils.getText('body')).to.include('Scan selected folders');
    expect(await app.utils.getText('body')).to.include('Google Drive');
    expect(await app.utils.getText('body')).to.include('Verified manifest + restore');
  });
});
