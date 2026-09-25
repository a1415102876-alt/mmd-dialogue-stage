import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(await readFile(resolve(publicRoot, 'mmd-dialogue-stage/library.json'), 'utf8'));
const { chromium } = await import(pathToFileURL(resolve(process.argv[2])).href);
const packs = {};
for (const [id, pack] of Object.entries(config.packs)) {
    const entries = await readdir(pack.root, { recursive: true, withFileTypes: true });
    packs[id] = { available: true, files: entries.filter(entry => entry.isFile()).map(entry => resolve(entry.parentPath || entry.path, entry.name).slice(resolve(pack.root).length + 1).split(sep).join('/')) };
}
const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (pathname === '/mmd-dialogue-stage/library/status') {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ packs }));
            return;
        }
        if (pathname === '/') {
            response.writeHead(200, { 'Content-Type': 'text/html' }).end('<style>canvas{width:640px;height:800px}</style><canvas id="portrait"></canvas><script type="importmap">{"imports":{"three":"/mmd-dialogue-stage/vendor/three/build/three.module.js","three/addons/":"/mmd-dialogue-stage/vendor/three/examples/jsm/"}}</script>');
            return;
        }
        let root = publicRoot;
        let relative = pathname.slice(1);
        const prefix = '/mmd-dialogue-stage/library/file/';
        if (pathname.startsWith(prefix)) {
            const tail = pathname.slice(prefix.length);
            const packId = Object.keys(config.packs).find(id => tail.startsWith(id + '/'));
            if (!packId) throw new Error('unknown pack');
            root = resolve(config.packs[packId].root);
            relative = tail.slice(packId.length + 1);
        }
        const file = resolve(root, relative);
        if (!file.startsWith(root + sep)) throw new Error('outside root');
        const body = await readFile(file);
        const type = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' }[extname(file)] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type }).end(body);
    } catch {
        response.writeHead(404).end();
    }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 660, height: 820 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('favicon')) errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result = await page.evaluate(async () => {
        const { LivePortraitRuntime } = await import('/mmd-dialogue-stage/live-portrait.js?v=20260911-performance1');
        const player = new LivePortraitRuntime(document.querySelector('canvas'));
        await player.prepare();
        await player.ensure();
        const results = [];
        for (const speaker of ['藤田琴音(害羞)', '藤田琴音(动作=讨好;表情=开心)', '藤田琴音(动作=说话;表情=自然)']) {
            const played = await player.playSpeakerCue(speaker);
            player.helper.update(0.3);
            const key = player.performanceKey;
            const ids = player.liveActions.map(action => action.getClip().name);
            await player.setTalking(true);
            results.push({ speaker, played, key, ids, afterTalking: player.liveActions.map(action => action.getClip().name), tracks: player.liveActions.map(action => action.getClip().tracks.length) });
        }
        player.resume();
        await new Promise(done => setTimeout(done, 200));
        player.pause();
        return { results, secondaryMotionBound: player.secondaryMotionBound, secondaryMotion: player.secondaryMotion.debugState?.() || null };
    });
    assert.equal(result.secondaryMotionBound, true, 'secondary motion must bind to the Live Portrait model');
    for (const entry of result.results) {
        assert.equal(entry.played, true, entry.speaker);
        assert.equal(entry.ids.length, 2);
        assert.deepEqual(entry.afterTalking, entry.ids);
        assert.ok(entry.tracks.every(count => count > 0));
    }
    assert.match(result.results[0].ids[0], /tereru/);
    assert.match(result.results[0].ids[1], /tereru/);
    assert.match(result.results[1].ids[0], /kobiru/);
    assert.match(result.results[1].ids[1], /facial-all/);
    const output = resolve(publicRoot, '../.tmp/portrait-performance-qa');
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: resolve(output, 'portrait.png') });
    await writeFile(resolve(output, 'results.json'), JSON.stringify({ result, errors }, null, 2));
    assert.deepEqual(errors.filter(message => !message.includes('404')), []);
    console.log(JSON.stringify({ output, result, errors }, null, 2));
} finally {
    await browser?.close();
    await new Promise(done => server.close(done));
}
