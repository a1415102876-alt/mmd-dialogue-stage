import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const [playwrightPath, modelPath, ...extraPaths] = process.argv.slice(2);
assert.ok(playwrightPath && modelPath, 'Usage: node render-smoke.mjs <playwright/index.mjs> <model.pmx> [motion.vmd] [playlist.vmd...]');
const vmdPaths = extraPaths.filter(path => /\.vmd$/i.test(path));
const playlistPaths = vmdPaths.length >= 4 ? vmdPaths.slice(0, 4) : [];
const motionPath = playlistPaths.length ? '' : (vmdPaths[0] || '');
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../../.tmp/gakumas-shader-qa');
await mkdir(output, { recursive: true });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
        if (file === resolve(root, 'app.js')) body = Buffer.concat([body, Buffer.from('\nglobalThis.__stageTest = { state, renderer, camera, controls, frameModel, applyMaterialStyle, hairCoverStage, secondaryMotion, scene, playPlaylistIndex, resetModelPose };')]);
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
    const textureDirectory = resolve(dirname(modelPath), 'Texture2D');
    await page.locator('#textureFolderInput').setInputFiles(textureDirectory);
    await page.locator('#modelFileInput').setInputFiles(resolve(modelPath));
    await page.waitForFunction(() => globalThis.__stageTest.state.gakumasTextures.length > 0 && document.querySelector('#runtimeBadge').textContent !== '载入中', null, { timeout: 60000 });
    const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.selectOption('#renderPreset', 'gakumas');
    await settle();
    assert.deepEqual(errors, []);
    await page.locator('#gakumasInspector summary').click();
    assert.equal(await page.evaluate(() => document.querySelector('#stageCanvas').getBoundingClientRect().height <= innerHeight + 1), true, 'Inspector expanded the desktop viewport');
    const bindings = await page.evaluate(() => {
        const { state } = globalThis.__stageTest;
        return state.model.material.map(material => ({
            name: material.name, role: material.userData.gakumasSelection.descriptor.role,
            textures: Object.fromEntries(Object.entries(material.userData.gakumasSelection.bindings).map(([kind, entry]) => [kind, { name: entry.name, loaded: !!entry.texture, colorSpace: entry.texture?.colorSpace }])),
            defines: material.defines,
        }));
    });
    for (const role of ['body', 'face', 'hair', 'eye']) {
        const material = bindings.find(entry => entry.role === role);
        assert.ok(material, `Missing ${role} material`);
        assert.ok(material.textures.shade.loaded && material.textures.def.loaded && material.textures.ramp.loaded, `${role} maps failed to bind`);
        assert.equal(material.textures.def.colorSpace, '');
    }
    assert.equal(bindings.find(entry => entry.role === 'hair').textures.highlight.loaded, true);
    assert.equal(bindings.find(entry => entry.role === 'face').defines.GK_FACE, true);
    const head = await page.evaluate(() => globalThis.__stageTest.state.gakumasHeadBone?.name);
    assert.ok(head, 'Head bone not found');
    assert.equal(await page.locator('#secondaryMotionToggle').isChecked(), true);
    const secondary = await page.evaluate(() => {
        const { state, secondaryMotion } = globalThis.__stageTest;
        const bone = name => state.model.skeleton.bones.find(item => item.name === name);
        const headBone = bone('Head');
        const hair = bone('LeftSideHair_A');
        const skirt = bone('LeftFrontSkirt_A');
        const leg = bone('LeftUpLeg');
        const result = { bound: secondaryMotion.bindings.length, missing: [...secondaryMotion.missing], enabled: secondaryMotion.enabled };
        if (!headBone || !hair || !skirt || !leg) return { ...result, skipped: true };
        const hairRest = hair.quaternion.toArray();
        const skirtRest = skirt.quaternion.toArray();
        const headRest = headBone.quaternion.toArray();
        const legRest = leg.quaternion.toArray();
        headBone.quaternion.setFromAxisAngle({ x: 1, y: 0, z: 0 }, 20 * Math.PI / 180);
        secondaryMotion.update();
        result.hairMoved = hair.quaternion.toArray().some((value, index) => Math.abs(value - hairRest[index]) > 1e-6);
        secondaryMotion.enabled = false;
        secondaryMotion.update();
        result.hairRestored = hair.quaternion.toArray().every((value, index) => Math.abs(value - hairRest[index]) < 1e-6);
        secondaryMotion.enabled = true;
        headBone.quaternion.fromArray(headRest);
        leg.quaternion.setFromAxisAngle({ x: 1, y: 0, z: 0 }, 15 * Math.PI / 180);
        secondaryMotion.update();
        result.skirtMoved = skirt.quaternion.toArray().some((value, index) => Math.abs(value - skirtRest[index]) > 1e-6);
        secondaryMotion.enabled = false;
        secondaryMotion.update();
        result.skirtRestored = skirt.quaternion.toArray().every((value, index) => Math.abs(value - skirtRest[index]) < 1e-6);
        secondaryMotion.enabled = true;
        headBone.quaternion.fromArray(headRest);
        leg.quaternion.fromArray(legRest);
        hair.quaternion.fromArray(hairRest);
        skirt.quaternion.fromArray(skirtRest);
        return result;
    });
    assert.equal(secondary.skipped, undefined, `Quartz bones missing: ${JSON.stringify(secondary)}`);
    assert.equal(secondary.bound, 10);
    assert.deepEqual(secondary.missing, []);
    assert.equal(secondary.hairMoved, true, 'Head tilt did not drive LeftSideHair_A');
    assert.equal(secondary.hairRestored, true, 'Disabling secondary motion did not restore hair rest');
    assert.equal(secondary.skirtMoved, true, 'UpLeg tilt did not drive LeftFrontSkirt_A');
    assert.equal(secondary.skirtRestored, true, 'Disabling secondary motion did not restore skirt rest');
    for (const mode of ['0', '1', '2', '3', '4', '5', '6', '7']) {
        await page.selectOption('#gakumasDebugView', mode);
        await settle();
        assert.equal(await page.evaluate(() => [...globalThis.__stageTest.state.gakumasUniforms][0].gkDebugView.value), Number(mode));
    }
    await page.selectOption('#gakumasDebugView', '0');
    assert.equal(await page.locator('#gakumasCharacterShadow').isChecked(), true);
    assert.equal(await page.locator('#gakumasHairCover').isChecked(), true);
    assert.equal(await page.locator('#gakumasHairShadow').count(), 0);
    await settle();
    assert.equal(await page.evaluate(() => [...globalThis.__stageTest.state.gakumasUniforms][0].gkCharacterShadowEnabled.value), 1);
    const shadowPolicy = await page.evaluate(() => {
        const mesh = globalThis.__stageTest.state.model;
        const light = globalThis.__stageTest.scene.children.find(child => child.isDirectionalLight && child.userData?.gakumasCharacterShadow);
        return {
            mapSize: light?.shadow.mapSize.toArray(),
            bias: light?.shadow.bias,
            normalBias: light?.shadow.normalBias,
            materials: mesh.material.map((material, index) => ({
                name: material.name,
                pass: material.userData.gakumasActorPass,
                receive: material.userData.gakumasUniforms?.gkCharacterShadowReceive?.value,
                cast: mesh.userData.gakumasShadowMaterialMask?.[index],
            })),
        };
    });
    assert.deepEqual(shadowPolicy.mapSize, [4096, 4096]);
    assert.equal(shadowPolicy.bias, 0);
    assert.equal(shadowPolicy.normalBias, 0);
    assert.equal(shadowPolicy.materials.find(entry => entry.pass === 'hair')?.receive, 1);
    assert.equal(shadowPolicy.materials.find(entry => entry.pass === 'hair')?.cast, true);
    assert.equal(shadowPolicy.materials.find(entry => entry.pass === 'face')?.receive, 1);
    assert.equal(shadowPolicy.materials.find(entry => entry.pass === 'face')?.cast, false);
    assert.equal(shadowPolicy.materials.find(entry => entry.pass === 'eye')?.receive, 1);
    assert.equal(shadowPolicy.materials.find(entry => entry.pass === 'eye')?.cast, false);
    assert.equal(shadowPolicy.materials.find(entry => entry.pass === 'body')?.receive, 1);
    assert.equal(shadowPolicy.materials.find(entry => entry.pass === 'body')?.cast, true);
    await page.screenshot({ path: resolve(output, 'gakumas-character-shadow-front.png') });
    const faceView = () => page.evaluate(() => {
        const { state, camera, controls } = globalThis.__stageTest;
        const headMatrix = state.gakumasHeadBone.matrixWorld.elements;
        controls.target.set(headMatrix[12], headMatrix[13], headMatrix[14]);
        camera.position.set(headMatrix[12], headMatrix[13] + 0.3, headMatrix[14] + 9);
        controls.update();
    });
    await faceView();
    await settle();
    const faceLit = await page.locator('#stageCanvas').screenshot({ path: resolve(output, 'character-shadow-face.png') });
    await page.selectOption('#gakumasDebugView', '7');
    await settle();
    await page.screenshot({ path: resolve(output, 'character-shadow-face-debug.png') });
    await page.selectOption('#gakumasDebugView', '0');
    await page.locator('#gakumasCharacterShadow').uncheck();
    await settle();
    const faceUnlit = await page.locator('#stageCanvas').screenshot({ path: resolve(output, 'character-shadow-face-off.png') });
    const faceShadowDifference = pixelDifference(faceLit, faceUnlit);
    assert.ok(faceShadowDifference > 20000, `Character shadow made no visible difference on the face (${faceShadowDifference})`);
    await page.locator('#gakumasCharacterShadow').check();
    await settle();
    const distanceDifferences = [];
    for (const distance of [9, 26, 60]) {
        await page.evaluate(distance => {
            const { state, camera, controls } = globalThis.__stageTest;
            const headMatrix = state.gakumasHeadBone.matrixWorld.elements;
            controls.target.set(headMatrix[12], headMatrix[13], headMatrix[14]);
            camera.position.set(headMatrix[12], headMatrix[13] + 0.3, headMatrix[14] + distance);
            controls.update();
        }, distance);
        await settle();
        const lit = await page.locator('#stageCanvas').screenshot();
        await page.locator('#gakumasCharacterShadow').uncheck();
        await settle();
        const unlit = await page.locator('#stageCanvas').screenshot();
        await page.locator('#gakumasCharacterShadow').check();
        await settle();
        distanceDifferences.push({ distance, difference: pixelDifference(lit, unlit) });
    }
    const angleDifferences = [];
    for (const angle of [-60, -30, 0, 30, 60]) {
        await page.evaluate(angle => {
            const { state, camera, controls } = globalThis.__stageTest;
            const headMatrix = state.gakumasHeadBone.matrixWorld.elements;
            const radians = angle * Math.PI / 180;
            controls.target.set(headMatrix[12], headMatrix[13], headMatrix[14]);
            camera.position.set(headMatrix[12] + 9 * Math.sin(radians), headMatrix[13] + 0.3, headMatrix[14] + 9 * Math.cos(radians));
            controls.update();
        }, angle);
        await settle();
        const lit = await page.locator('#stageCanvas').screenshot();
        await page.locator('#gakumasCharacterShadow').uncheck();
        await settle();
        const unlit = await page.locator('#stageCanvas').screenshot();
        await page.locator('#gakumasCharacterShadow').check();
        await settle();
        angleDifferences.push({ angle, difference: pixelDifference(lit, unlit) });
    }
    console.log(JSON.stringify({ faceShadowDifference, distanceDifferences, angleDifferences }, null, 2));
    for (const entry of distanceDifferences) {
        assert.ok(entry.difference > 5000, `Character shadow vanished at camera distance ${entry.distance} (${entry.difference})`);
    }
    for (const entry of angleDifferences) {
        assert.ok(entry.difference > 5000, `Character shadow vanished at camera azimuth ${entry.angle} (${entry.difference})`);
    }
    await page.evaluate(() => {
        const { state, camera, controls, frameModel } = globalThis.__stageTest;
        frameModel(state.model);
        camera.updateProjectionMatrix();
        controls.update();
    });
    await settle();
    await page.locator('#gakumasCharacterShadow').check();
    await settle();
    await page.evaluate(() => {
        const { camera, controls } = globalThis.__stageTest;
        camera.position.set(controls.target.x + 12, controls.target.y + 2, controls.target.z + 12);
        controls.update();
    });
    await settle();
    await page.screenshot({ path: resolve(output, 'gakumas-character-shadow-oblique.png') });
    await page.evaluate(() => {
        const { camera, controls, frameModel, state } = globalThis.__stageTest;
        frameModel(state.model);
        camera.updateProjectionMatrix();
        controls.update();
    });
    await settle();
    await page.locator('#gakumasCharacterShadow').uncheck();
    await page.locator('#gakumasHairCover').uncheck();
    await settle();
    const sourceSnapshot = () => page.evaluate(() => {
        const { state, scene } = globalThis.__stageTest;
        return { children: scene.children.map(child => child.uuid), groups: state.model.geometry.groups,
            materials: state.model.material.map(material => ({ uuid: material.uuid, map: material.map?.uuid, visible: material.visible, type: material.type, opacity: material.opacity, stencil: material.stencilWrite, depthWrite: material.depthWrite, transparent: material.transparent })) };
    });
    const originalSources = await sourceSnapshot();
    const canvasBox = await page.locator('#stageCanvas').boundingBox();
    const bodyClip = { x: canvasBox.x, y: canvasBox.y + canvasBox.height * 0.6, width: canvasBox.width, height: canvasBox.height * 0.4 };
    await settle();
    const bodyBefore = await page.screenshot({ clip: bodyClip });
    await page.screenshot({ path: resolve(output, 'gakumas-hair-cover-off.png') });
    await page.locator('#gakumasHairCover').check();
    await settle();
    assert.deepEqual(errors, [], 'HairCover triggered a render/outline exception');
    assert.deepEqual(await sourceSnapshot(), originalSources, 'HairCover changed original meshes/materials/groups');
    assert.deepEqual(await page.screenshot({ clip: bodyClip }), bodyBefore, 'HairCover changed body pixels');
    const hairPass = await page.evaluate(() => {
        const { hairCoverStage } = globalThis.__stageTest;
        return { draws: hairCoverStage.lastDraws, entries: hairCoverStage.entries.map(entry => ({
            source: entry.source.name, sameMap: entry.source.map === entry.material.map,
            materialOpacity: entry.material.opacity, depthWrite: entry.material.depthWrite, stencilWrite: entry.material.stencilWrite,
        })) };
    });
    assert.ok(hairPass.entries.length > 0);
    console.log(JSON.stringify({ hairPass }, null, 2));
    assert.ok(hairPass.entries.every(entry => entry.source.trim().toLowerCase() === 'm_hir' && entry.sameMap && !entry.depthWrite && !entry.stencilWrite));
    assert.ok(hairPass.draws.length > 0);
    assert.ok(hairPass.draws.every(draw => draw.name.trim().toLowerCase() === 'm_hir' && draw.count > 0));
    assert.equal(hairPass.entries[0].sameMap, true);
    assert.equal(hairPass.entries[0].depthWrite, false);
    assert.equal(hairPass.entries[0].stencilWrite, false);
    for (let iteration = 0; iteration < 3; iteration++) {
        await page.locator('#gakumasHairCover').uncheck();
        await settle();
        assert.equal(await page.evaluate(() => globalThis.__stageTest.hairCoverStage.lastDraws.length), 0);
        await page.locator('#gakumasHairCover').check();
        await settle();
        assert.deepEqual(await sourceSnapshot(), originalSources);
    }
    await page.screenshot({ path: resolve(output, 'gakumas-hair-cover.png') });
    await page.evaluate(() => {
        const { state, camera, controls } = globalThis.__stageTest;
        const headMatrix = state.gakumasHeadBone.matrixWorld.elements;
        const headPosition = { x: headMatrix[12], y: headMatrix[13], z: headMatrix[14] };
        controls.target.copy(headPosition);
        camera.position.set(headPosition.x, headPosition.y + 0.3, headPosition.z + 9);
        controls.update();
    });
    await settle();
    await page.locator('#gakumasHairCover').uncheck();
    await settle();
    await page.screenshot({ path: resolve(output, 'gakumas-face-off.png') });
    await page.locator('#gakumasHairCover').check();
    const setMinimum = value => page.locator('#gakumasHairCoverMinimum').evaluate((input, value) => {
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await setMinimum(0);
    await settle();
    await page.screenshot({ path: resolve(output, 'gakumas-face-strict.png') });
    const strictFace = await page.locator('#stageCanvas').screenshot();
    await setMinimum(0.35);
    await settle();
    await page.screenshot({ path: resolve(output, 'gakumas-face-compensated.png') });
    const compensatedFace = await page.locator('#stageCanvas').screenshot();
    assert.notDeepEqual(strictFace, compensatedFace, 'Minimum coverage slider made no visible difference');
    await setMinimum(0.8);
    await settle();
    await page.screenshot({ path: resolve(output, 'gakumas-face-strong.png') });
    assert.notDeepEqual(await page.locator('#stageCanvas').screenshot(), compensatedFace);
    await setMinimum(0.35);
    await settle();
    await page.screenshot({ path: resolve(output, 'gakumas-hair-cover-face.png') });
    await page.evaluate(() => {
        const { state, camera, controls } = globalThis.__stageTest;
        const headMatrix = state.gakumasHeadBone.matrixWorld.elements;
        const headPosition = { x: headMatrix[12], y: headMatrix[13], z: headMatrix[14] };
        controls.target.copy(headPosition);
        camera.position.set(headPosition.x, headPosition.y + 0.3, headPosition.z - 9);
        controls.update();
    });
    await settle();
    await page.screenshot({ path: resolve(output, 'gakumas-hair-cover-face-back.png') });
    await page.evaluate(() => {
        const { camera, controls } = globalThis.__stageTest;
        camera.position.set(controls.target.x + 7, controls.target.y + 0.3, controls.target.z + 7);
        controls.update();
    });
    await settle();
    await page.screenshot({ path: resolve(output, 'gakumas-hair-cover-side.png') });
    const highlightVisibility = [];
    for (const angle of [60, 90]) {
        await page.evaluate(angle => {
            const { camera, controls } = globalThis.__stageTest;
            const radians = angle * Math.PI / 180;
            camera.position.set(controls.target.x + 9 * Math.sin(radians), controls.target.y + 0.3, controls.target.z + 9 * Math.cos(radians));
            controls.update();
        }, angle);
        const differences = [];
        for (const enabled of [false, true]) {
            await page.locator('#gakumasHairCover').setChecked(enabled);
            await settle();
            const visible = await page.locator('#stageCanvas').screenshot({ path: resolve(output, `highlight-${angle}-cover-${enabled}.png`) });
            await page.evaluate(() => {
                const context = globalThis.__stageTest;
                context.hiddenHighlights = context.state.model.material.filter(material => material.name === 'm_hir+').map(material => [material, material.visible]);
                context.hiddenHighlights.forEach(([material]) => { material.visible = false; });
            });
            await settle();
            const hidden = await page.locator('#stageCanvas').screenshot();
            await page.evaluate(() => {
                globalThis.__stageTest.hiddenHighlights.forEach(([material, visible]) => { material.visible = visible; });
            });
            await settle();
            differences.push(pixelDifference(visible, hidden));
        }
        highlightVisibility.push({ angle, withoutCover: differences[0], withCover: differences[1] });
    }
    console.log(JSON.stringify({ highlightVisibility }, null, 2));
    assert.ok(highlightVisibility.some(entry => entry.withoutCover > 100), 'No visible source highlights in side-view fixture');
    for (const entry of highlightVisibility) {
        if (entry.withoutCover > 100) assert.ok(entry.withCover >= entry.withoutCover * 0.8, `HairCover erased side highlights at ${entry.angle} degrees`);
    }
    await settle();
    await page.locator('#gakumasHairCover').uncheck();
    await settle();
    if (motionPath) {
        await page.locator('#gakumasHairCover').check();
        await page.evaluate(() => {
            const context = globalThis.__stageTest;
            context.passProof = {};
            context.originalDirect = context.renderer.renderBufferDirect;
            context.renderer.renderBufferDirect = function (camera, scene, geometry, material, mesh, group) {
                if (mesh === context.state.model && material.isMMDToonMaterial && (material.name === 'm_hir' || material.defines.GK_HAIR_COVER_PASS)) {
                    const key = material.defines.GK_HAIR_COVER_PASS ? 'cover' : 'base';
                    context.passProof[key] = { bones: [...mesh.skeleton.boneMatrices], morphs: [...mesh.morphTargetInfluences] };
                }
                return context.originalDirect.call(this, camera, scene, geometry, material, mesh, group);
            };
        });
        await page.locator('#motionInput').setInputFiles(resolve(motionPath));
        await page.waitForFunction(() => globalThis.__stageTest.state.playing && globalThis.__stageTest.state.actions.size > 0);
        const previous = await page.evaluate(() => { const { state } = globalThis.__stageTest; return state.helper.objects.get(state.model).mixer.time; });
        await settle();
        const current = await page.evaluate(() => { const { state } = globalThis.__stageTest; return state.helper.objects.get(state.model).mixer.time; });
        assert.ok(current > previous, 'Animation mixer did not advance');
        await page.locator('#playPauseBtn').click();
        await page.evaluate(() => {
            const { state } = globalThis.__stageTest;
            state.helper.objects.get(state.model).mixer.setTime([...state.actions.values()][0].clip.duration * 0.5);
            state.model.morphTargetInfluences[0] = 0.7;
        });
        await settle();
        const proof = await page.evaluate(() => globalThis.__stageTest.passProof);
        assert.ok(proof.cover && proof.base, 'Missing actual base/cover draw during animation');
        assert.deepEqual(proof.cover, proof.base, 'Passes used different bone or morph values');
        assert.equal(proof.cover.morphs[0], 0.7);
        await page.screenshot({ path: resolve(output, 'gakumas-hair-cover-motion.png') });
        await page.evaluate(() => {
            const context = globalThis.__stageTest;
            context.renderer.renderBufferDirect = context.originalDirect;
            context.state.model.morphTargetInfluences[0] = 0;
        });
    }
    await page.evaluate(() => {
        const { state, controls, camera, frameModel } = globalThis.__stageTest;
        controls.maxDistance = 1000;
        frameModel(state.model);
        camera.position.sub(controls.target).multiplyScalar(1.5).add(controls.target);
        controls.update();
    });
    await settle();
    await page.screenshot({ path: resolve(output, 'gakumas.png') });
    for (const preset of ['mmd', 'stage', 'soft', 'gakumas']) {
        await page.selectOption('#renderPreset', preset);
        await settle();
        assert.equal(await page.locator('#gakumasInspector').isVisible(), preset === 'gakumas');
    }
    const beforeAxis = await page.evaluate(() => [...globalThis.__stageTest.state.gakumasUniforms][0].gkHeadRight.value.toArray());
    await page.evaluate(() => {
        const { camera, controls } = globalThis.__stageTest;
        camera.position.sub(controls.target).applyAxisAngle({ x: 0, y: 1, z: 0 }, 0.7).add(controls.target);
        controls.update();
    });
    await settle();
    const afterAxis = await page.evaluate(() => [...globalThis.__stageTest.state.gakumasUniforms][0].gkHeadRight.value.toArray());
    assert.deepEqual(beforeAxis, afterAxis, 'Face axis should stay in world space; MatCap follows the camera in-shader');
    await page.screenshot({ path: resolve(output, 'gakumas-rotated.png') });
    await page.evaluate(() => {
        const { state, applyMaterialStyle } = globalThis.__stageTest;
        globalThis.__stageTest.savedTextures = state.gakumasTextures;
        state.gakumasTextures = [];
        applyMaterialStyle();
    });
    await settle();
    assert.equal(await page.evaluate(() => [...globalThis.__stageTest.state.gakumasUniforms].every(uniforms => uniforms.gkHasShade.value === 0 && uniforms.gkHasRamp.value === 0)), true);
    await page.evaluate(() => {
        const { state, applyMaterialStyle, savedTextures } = globalThis.__stageTest;
        state.gakumasTextures = savedTextures;
        applyMaterialStyle();
    });
    await settle();
    const programs = await page.evaluate(() => globalThis.__stageTest.renderer.info.programs.map(program => ({ name: program.name, runnable: program.diagnostics?.runnable ?? true })));
    assert.ok(programs.length > 0);
    assert.ok(programs.every(program => program.runnable), 'GPU shader compilation failed');
    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile layout has horizontal overflow');
    await page.screenshot({ path: resolve(output, 'gakumas-mobile.png'), fullPage: true });
    let playlistReport = null;
    if (playlistPaths.length >= 4) {
        await page.locator('#loopToggle').uncheck();
        await page.locator('#motionInput').setInputFiles(playlistPaths.slice(0, 4).map(path => resolve(path)));
        await page.waitForFunction(() => globalThis.__stageTest.state.playlist.length >= 2, null, { timeout: 60000 });
        playlistReport = await page.evaluate(async () => {
            const { state, playPlaylistIndex } = globalThis.__stageTest;
            const wait = frames => new Promise(done => {
                const step = () => frames-- <= 0 ? done() : requestAnimationFrame(step);
                requestAnimationFrame(step);
            });
            const morphTracks = clipIds => {
                const indices = new Set();
                for (const id of clipIds) {
                    for (const track of state.actions.get(id)?.clip.tracks || []) {
                        const match = /^\.morphTargetInfluences\[(\d+)\]$/.exec(track.name);
                        if (match) indices.add(Number(match[1]));
                    }
                }
                return [...indices];
            };
            const snapshot = () => ({
                items: state.playlist.map(item => ({ key: item.key, body: !!item.body, face: !!item.face })),
                active: [...state.activeClipIds],
                playing: state.playing,
                morphs: [...(state.model.morphTargetInfluences || [])],
                writtenMorphs: morphTracks(state.activeClipIds),
                hips: state.model.skeleton.bones.find(bone => bone.name === 'Hips')?.quaternion.toArray() || [],
            });
            playPlaylistIndex(0);
            await wait(12);
            const first = snapshot();
            playPlaylistIndex(1);
            await wait(12);
            const second = snapshot();
            const leftover = first.writtenMorphs.filter(index => !second.writtenMorphs.includes(index) && second.morphs[index] > 0.02);
            return { first, second, leftover };
        });
        assert.ok(playlistReport.first.items.some(item => item.body && item.face), 'Body and face clips did not pair');
        assert.equal(playlistReport.first.active.length, 2);
        assert.equal(playlistReport.second.active.length, 2);
        assert.notDeepEqual(playlistReport.first.active, playlistReport.second.active);
        assert.deepEqual(playlistReport.leftover, [], `Previous facial VMD leaked morphs ${playlistReport.leftover.join(',')}`);
        assert.notDeepEqual(playlistReport.first.hips, playlistReport.second.hips, 'Switching clips left the previous body pose');
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ materials: bindings.length, roles: [...new Set(bindings.map(entry => entry.role))], head, motionChecked: !!motionPath, playlistChecked: !!playlistReport, fallbackChecked: true, programs: programs.length, errors, screenshots: output }, null, 2));
} finally {
    await browser?.close();
    await new Promise(resolveServer => server.close(resolveServer));
}
