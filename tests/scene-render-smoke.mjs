import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Usage: node scene-render-smoke.mjs <playwright/index.mjs> [model.pmx]
// Serves the stage and library packs on 127.0.0.1 without auth, loads every
// configured scene and screenshots each camera layout.
const [playwrightPath, modelPath] = process.argv.slice(2);
assert.ok(playwrightPath, 'Usage: node scene-render-smoke.mjs <playwright/index.mjs> [model.pmx]');
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../../.tmp/gakumas-scene-qa');
await mkdir(output, { recursive: true });
const library = JSON.parse(await readFile(resolve(root, 'library.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };
const libraryMount = '/mmd-dialogue-stage/library/file/';

function resolveRequest(pathname) {
    if (pathname.startsWith(libraryMount)) {
        const rest = pathname.slice(libraryMount.length);
        const packId = Object.keys(library.packs || {}).sort((a, b) => b.length - a.length).find(id => rest.startsWith(`${id}/`));
        if (!packId) return null;
        const packRoot = resolve(library.packs[packId].root);
        const file = resolve(packRoot, rest.slice(packId.length + 1));
        return file.startsWith(packRoot + sep) ? file : null;
    }
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    return file.startsWith(root + sep) ? file : null;
}

const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const file = resolveRequest(pathname);
        if (!file) { response.writeHead(404).end(); return; }
        let body = await readFile(file);
        if (file === resolve(root, 'app.js')) body = Buffer.concat([body, Buffer.from('\nglobalThis.__stageTest = { state, renderer, camera, controls, scene, sceneStage, floor, grid };')]);
        response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
    } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));

let browser;
try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=d3d11', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        const text = message.text();
        if ((message.type() === 'error' || /THREE\.WebGLProgram|Shader Error/.test(text)) && !text.includes('404')) errors.push(text);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!globalThis.__stageTest && document.querySelectorAll('#sceneSelect option').length > 1, null, { timeout: 30000 });
    const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
    await page.locator('.tab[data-tab="assets"]').click();
    if (modelPath) {
        await page.locator('#textureFolderInput').setInputFiles(resolve(dirname(modelPath), 'Texture2D'));
        await page.locator('#modelFileInput').setInputFiles(resolve(modelPath));
        await page.waitForFunction(() => !!globalThis.__stageTest.state.model, null, { timeout: 90000 });
        await page.selectOption('#renderPreset', 'gakumas');
    }
    const report = [];
    for (const entry of library.scenes || []) {
        const started = Date.now();
        await page.selectOption('#sceneSelect', entry.id);
        await page.waitForFunction(() => /场景已载入|场景载入失败/.test(document.querySelector('#statusText').textContent), null, { timeout: 180000 });
        const status = await page.locator('#sceneStatus').textContent();
        assert.ok(!/失败/.test(status), status);
        const floorState = await page.evaluate(() => ({ floor: globalThis.__stageTest.floor.visible, grid: globalThis.__stageTest.grid.visible }));
        assert.deepEqual(floorState, { floor: false, grid: false }, 'Floor and grid should hide while a scene is active');
        // SCENE_QA_SHARED='{"gkDirectScale":0}' isolates shading terms for comparison shots.
        const sharedOverrides = JSON.parse(process.env.SCENE_QA_SHARED || '{}');
        await page.evaluate(overrides => {
            const { shared } = globalThis.__stageTest.sceneStage;
            for (const [name, value] of Object.entries(overrides)) if (shared[name]) shared[name].value = value;
        }, sharedOverrides);
        // SCENE_QA_HIDE='trs02|farbg' hides meshes whose material name matches.
        if (process.env.SCENE_QA_HIDE) {
            await page.evaluate(pattern => {
                const match = new RegExp(pattern);
                globalThis.__stageTest.sceneStage.root.traverse(object => {
                    if (object.isMesh && match.test(object.material?.name || '')) object.visible = false;
                });
            }, process.env.SCENE_QA_HIDE);
        }
        const tag = process.env.SCENE_QA_TAG ? `-${process.env.SCENE_QA_TAG}` : '';
        const layouts = await page.$$eval('#sceneLayout option', options => options.map(option => option.value));
        for (const layout of layouts) {
            await page.selectOption('#sceneLayout', layout);
            await settle();
            const info = await page.evaluate(() => {
                const { camera, controls, sceneStage, renderer } = globalThis.__stageTest;
                return {
                    camera: camera.position.toArray().map(value => +value.toFixed(2)),
                    target: controls.target.toArray().map(value => +value.toFixed(2)),
                    fov: camera.fov,
                    far: camera.far,
                    status: document.querySelector('#sceneStatus').textContent,
                    programs: renderer.info.programs?.length,
                    calls: renderer.info.render.calls,
                    volumes: sceneStage.grade?.volumes,
                };
            });
            const file = resolve(output, `${entry.id}-${layout}${modelPath ? '-actor' : ''}${tag}.png`);
            await page.locator('#stageCanvas').screenshot({ path: file });
            report.push({ scene: entry.id, layout, loadMs: Date.now() - started, file, ...info });
        }
        await page.selectOption('#sceneSelect', '');
        await settle();
        const restored = await page.evaluate(() => ({ floor: globalThis.__stageTest.floor.visible, loaded: globalThis.__stageTest.sceneStage.loaded, fov: globalThis.__stageTest.camera.fov }));
        assert.deepEqual(restored, { floor: true, loaded: false, fov: 32 });
    }
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log('scene render smoke ok');
} finally {
    await browser?.close();
    server.close();
}
