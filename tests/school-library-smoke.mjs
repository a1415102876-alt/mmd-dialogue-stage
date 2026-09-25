import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { libraryStatus, safeJoinLibraryPath } from '../../../src/endpoints/mmd-library.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(await readFile(resolve(root, 'mmd-dialogue-stage/library.json'), 'utf8'));
const status = libraryStatus(config);
const schoolIds = ['hski', 'hume', 'hrnm', 'ssmk', 'kllj', 'jsna', 'hmsz', 'atbm'];
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
for (const id of schoolIds) {
    const idol = config.idols.find(item => item.id === id);
    assert.equal(idol.outfit, 'SCHL-0000');
    assert.ok(status.packs[idol.pack]?.files.includes(idol.model), `${id} school PMX missing`);
}
const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
        if (pathname === '/mmd-dialogue-stage/library/status') {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(status));
            return;
        }
        let file;
        const prefix = '/mmd-dialogue-stage/library/file/';
        if (pathname.startsWith(prefix)) {
            const tail = pathname.slice(prefix.length);
            const pack = Object.keys(config.packs).find(key => tail.startsWith(key + '/'));
            if (!pack) throw new Error('unknown pack');
            file = safeJoinLibraryPath(config.packs[pack].root, tail.slice(pack.length + 1));
        } else {
            file = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
            if (!file.startsWith(root + sep)) throw new Error('outside root');
        }
        let content = await readFile(file);
        if (file === resolve(root, 'mmd-dialogue-stage/app.js')) {
            content = Buffer.concat([content, Buffer.from('\nglobalThis.__schoolQA = { state, secondaryMotion, catalogItems };')]);
        }
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[extname(file)] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type }).end(content);
    } catch {
        response.writeHead(404).end();
    }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const results = [];
const errors = [];
const output = resolve(root, '../.tmp/school-library-qa');
await mkdir(output, { recursive: true });
try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/mmd-dialogue-stage/`);
    await page.waitForFunction(() => document.querySelectorAll('#idolList .idol-card').length === 13);
    for (const id of [...schoolIds, 'fktn', schoolIds[0]]) {
        const idol = config.idols.find(item => item.id === id);
        const card = page.locator('#idolList .idol-card').filter({ has: page.locator('strong', { hasText: idol.name }) });
        await card.locator('button').click({ force: true });
        await page.waitForFunction(idol => {
            const state = globalThis.__schoolQA?.state;
            return state?.library.activeIdol === idol.id && document.querySelector('#modelFileName')?.textContent === idol.model
                && document.querySelector('#runtimeBadge')?.textContent === '模型就绪';
        }, idol, { timeout: 90000 });
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        const result = await page.evaluate(() => {
            const { state, secondaryMotion, catalogItems } = globalThis.__schoolQA;
            return {
                idol: state.library.activeIdol, file: state.modelFile.name,
                vertices: state.model.geometry.attributes.position.count,
                colors: state.model.geometry.attributes.gakumasVertexColor?.count,
                missingBaseMaps: state.model.material.filter(material => !material.map).map(material => material.name),
                textures: state.gakumasTextures.map(entry => entry.name),
                springs: secondaryMotion.springs.length,
                foreignMotions: catalogItems().filter(item => !['cmmn', state.library.activeIdol].includes(item.character)).length,
            };
        });
        assert.equal(result.file, idol.model);
        assert.equal(result.vertices, result.colors);
        assert.deepEqual(result.missingBaseMaps, []);
        assert.equal(result.foreignMotions, 0);
        if (id !== 'fktn') {
            assert.equal(result.springs, 0);
            assert.ok(result.textures.some(name => name.includes(`${id}-schl-0000`)), 'must actually load school textures');
        } else assert.ok(result.springs > 0);
        await page.screenshot({ path: resolve(output, `${results.length}-${id}.png`) });
        results.push(result);
        console.log(JSON.stringify({ id, file: result.file, vertices: result.vertices, springs: result.springs, passed: true }));
    }
    assert.deepEqual(errors, []);
} finally {
    await writeFile(resolve(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
    await browser?.close();
    await new Promise(done => server.close(done));
}
