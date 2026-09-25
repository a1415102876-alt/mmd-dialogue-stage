import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [playwrightPath, modelPath] = process.argv.slice(2);
assert.ok(playwrightPath && modelPath, 'Usage: node secondary-motion-smoke.mjs <playwright/index.mjs> <model.pmx>');
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
        let body = await readFile(file);
        if (file === resolve(root, 'app.js')) body = Buffer.concat([body, Buffer.from('\nglobalThis.__stageTest = { state, secondaryMotion };')]);
        response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
    } catch { response.writeHead(404).end(); }
});
await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
let browser;
try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!globalThis.__stageTest);
    const textureDirectory = resolve(dirname(modelPath), 'Texture2D');
    await page.locator('#textureFolderInput').setInputFiles(textureDirectory);
    await page.locator('#modelFileInput').setInputFiles(resolve(modelPath));
    await page.waitForFunction(() => document.querySelector('#runtimeBadge').textContent === '模型就绪', null, { timeout: 60000 });
    assert.equal(await page.locator('#secondaryMotionToggle').isChecked(), true);
    const report = await page.evaluate(() => {
        const { state, secondaryMotion } = globalThis.__stageTest;
        const bone = name => state.model.skeleton.bones.find(item => item.name === name);
        const head = bone('Head');
        const hair = bone('LeftSideHair_A');
        const hair4 = bone('LeftSideHair4_S');
        const skirt = bone('LeftFrontSkirt_A');
        const leg = bone('LeftUpLeg');
        const result = {
            bound: secondaryMotion.bindings.length,
            springs: secondaryMotion.springs.length,
            colliders: secondaryMotion.colliders.length,
            missing: [...secondaryMotion.missing],
            status: document.querySelector('#secondaryMotionStatus')?.textContent || '',
        };
        if (!head || !hair || !skirt || !leg || !hair4) return { ...result, skipped: true };
        const hairRest = hair.quaternion.toArray();
        const hair4Rest = hair4.quaternion.toArray();
        const skirtRest = skirt.quaternion.toArray();
        const headRest = head.quaternion.toArray();
        const legRest = leg.quaternion.toArray();
        head.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, 25 * Math.PI / 180);
        const spring = secondaryMotion.springs.find(item => item.record.bone === 'LeftSideHair4_S');
        if (spring) {
            spring.current = spring.current.map((value, index) => value + [0.12, 0.04, 0.08][index]);
            spring.previous = [...spring.current];
        }
        secondaryMotion.update(1 / 60);
        result.hairMoved = hair.quaternion.toArray().some((value, index) => Math.abs(value - hairRest[index]) > 1e-6);
        result.hair4Moved = hair4.quaternion.toArray().some((value, index) => Math.abs(value - hair4Rest[index]) > 1e-6);
        document.querySelector('#secondaryMotionToggle').click();
        secondaryMotion.update();
        result.toggleOff = !secondaryMotion.enabled;
        result.hairRestored = hair.quaternion.toArray().every((value, index) => Math.abs(value - hairRest[index]) < 1e-6);
        document.querySelector('#secondaryMotionToggle').click();
        head.quaternion.fromArray(headRest);
        leg.quaternion.setFromAxisAngle({ x: 1, y: 0, z: 0 }, 15 * Math.PI / 180);
        secondaryMotion.update();
        result.skirtMoved = skirt.quaternion.toArray().some((value, index) => Math.abs(value - skirtRest[index]) > 1e-6);
        head.quaternion.fromArray(headRest);
        leg.quaternion.fromArray(legRest);
        hair.quaternion.fromArray(hairRest);
        skirt.quaternion.fromArray(skirtRest);
        return result;
    });
    assert.equal(report.skipped, undefined, `Quartz bones missing: ${JSON.stringify(report)}`);
    assert.equal(report.bound, 10);
    assert.match(report.status, /已绑定 10 个跟随/);
    assert.ok(report.springs >= 1, 'No spring bones bound');
    assert.equal(report.hairMoved, true);
    assert.equal(report.hair4Moved, true, `Side-hair spring did not write LeftSideHair4_S ${JSON.stringify(report)}`);
    assert.deepEqual(report.missing, []);
    assert.equal(report.toggleOff, true);
    assert.equal(report.hairRestored, true);
    assert.equal(report.skirtMoved, true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, ...report }, null, 2));
} finally {
    await browser?.close();
    await new Promise(resolveServer => server.close(resolveServer));
}
