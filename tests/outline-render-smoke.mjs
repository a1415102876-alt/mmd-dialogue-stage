import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const [playwrightPath, modelPath] = process.argv.slice(2);
assert.ok(playwrightPath && modelPath, 'Usage: node render-smoke.mjs <playwright/index.mjs> <model.pmx> [motion.vmd]');
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../../.tmp/gakumas-shader-qa');
await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function pixelDifference(firstBuffer, secondBuffer) {
    const first = PNG.sync.read(firstBuffer);
    const second = PNG.sync.read(secondBuffer);
    assert.equal(first.width, second.width);
    assert.equal(first.height, second.height);
    let total = 0;
    for (let offset = 0; offset < first.data.length; offset += 4) {
        for (let channel = 0; channel < 3; channel++) total += Math.abs(first.data[offset + channel] - second.data[offset + channel]);
    }
    return total;
}
const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
        let body = await readFile(file);
        if (file === resolve(root, 'app.js')) body = Buffer.concat([body, Buffer.from('\nglobalThis.__stageTest = { state, renderer, camera, controls, frameModel, applyMaterialStyle, hairCoverStage, scene, lookPass, THREE };')]);
        response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
    } catch { response.writeHead(404).end(); }
});
await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
let browser;
try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!globalThis.__stageTest);
    await page.locator('#textureFolderInput').setInputFiles(resolve(dirname(modelPath), 'Texture2D'));
    await page.locator('#modelFileInput').setInputFiles(resolve(modelPath));
    await page.waitForFunction(() => !!globalThis.__stageTest.state.model && document.querySelector('#runtimeBadge').textContent !== '载入中', null, { timeout: 60000 });
    const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const thickness = async value => {
        await page.evaluate(value => {
            const input = document.querySelector('#outlineThickness');
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        await settle();
    };
    await page.selectOption('#renderPreset', 'gakumas', { force: true });
    await settle();
    if (process.env.GAKUMAS_LOOK_QA) {
        await page.evaluate(() => {
            const { state, camera, controls, THREE } = globalThis.__stageTest;
            const box = new THREE.Box3().setFromObject(state.model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            controls.target.set(center.x, box.min.y + size.y * 0.77, center.z);
            camera.position.set(center.x, controls.target.y, center.z + size.y * 0.9);
            camera.lookAt(controls.target);
            controls.update();
        });
        await thickness('0.0022');
        const label = process.env.GAKUMAS_LOOK_QA;
        for (const debug of [0, 2, 4, 5, 6]) {
            await page.evaluate(debug => { globalThis.__stageTest.state.gakumasDebugView = debug; }, debug);
            await settle();
            await page.screenshot({ path: resolve(output, `${label}-debug-${debug}.png`) });
        }
        await page.evaluate(() => { globalThis.__stageTest.state.gakumasDebugView = 0; });
        console.log(JSON.stringify(await page.evaluate(() => globalThis.__stageTest.state.model.material.map(material => ({ name: material.name, bindings: Object.fromEntries(Object.entries(material.userData.gakumasUniforms || {}).filter(([name]) => /Map$|Has|Strength|Floor/.test(name)).map(([name, uniform]) => [name, uniform.value?.isTexture ? { file: uniform.value.userData.sourceName, colorSpace: uniform.value.colorSpace } : uniform.value])) }))), null, 2));
        assert.deepEqual(errors, []);
    }
    const diagnostics = await page.evaluate(() => globalThis.__stageTest.state.model.material.map(material => ({ name: material.name, mapFileName: material.userData?.MMD?.mapFileName, pass: material.userData?.gakumasActorPass, transparent: material.transparent, depthWrite: material.depthWrite, alphaLayer: material.userData?.gakumasAlphaLayer })));
    console.log(JSON.stringify(diagnostics.filter(item => /eye|瞳|眼|hirco/i.test(`${item.name} ${item.mapFileName}`)), null, 2));
    const counts = await page.evaluate(() => {
        const { model } = globalThis.__stageTest.state;
        return { vertices: model.geometry.attributes.position.count, colors: model.geometry.attributes.gakumasVertexColor.count, extraUV: model.geometry.userData.MMD.additionalUvNum, enabled: model.material.every(material => material.userData.gakumasVertexColorEnabled) };
    });
    assert.equal(counts.vertices, counts.colors);
    assert.equal(counts.extraUV, 3);
    assert.equal(counts.enabled, true);
    const snapshot = () => page.evaluate(() => globalThis.__stageTest.state.model.material.map(material => ({ id: material.uuid, map: material.map?.uuid, visible: material.visible })));
    const sources = await snapshot();
    await thickness('0');
    const without = await page.screenshot({ path: resolve(output, 'outline-off.png') });
    await thickness('0.0022');
    const withOutline = await page.screenshot({ path: resolve(output, 'outline-packed-front.png') });
    const difference = pixelDifference(without, withOutline);
    assert.ok(difference > 0, 'Packed outline has no visible effect');
    assert.deepEqual(await snapshot(), sources);
    await page.evaluate(() => {
        const { camera, controls } = globalThis.__stageTest;
        const radius = camera.position.distanceTo(controls.target);
        camera.position.set(controls.target.x + radius, controls.target.y, controls.target.z);
        camera.lookAt(controls.target);
        controls.update();
    });
    await settle();
    await page.screenshot({ path: resolve(output, 'outline-packed-side.png') });
    await page.selectOption('#renderPreset', 'mmd', { force: true });
    await settle();
    assert.equal(await page.evaluate(() => globalThis.__stageTest.state.model.material.some(material => material.userData.gakumasVertexColorEnabled)), false);
    await page.evaluate(() => globalThis.__stageTest.state.model.geometry.deleteAttribute('gakumasVertexColor'));
    await page.selectOption('#renderPreset', 'gakumas', { force: true });
    await settle();
    assert.equal(await page.evaluate(() => globalThis.__stageTest.state.model.material.some(material => material.userData.gakumasVertexColorEnabled)), false);
    assert.deepEqual(errors, [], 'Outline caused WebGL/JavaScript errors');
    console.log(JSON.stringify({ counts, difference, errors, output }, null, 2));
} finally {
    await browser?.close();
    await new Promise(done => server.close(done));
}

