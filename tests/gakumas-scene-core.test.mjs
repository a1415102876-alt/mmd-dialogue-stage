import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyRootRotation,
    applyRootTransform,
    decalUv,
    gtTonemap,
    layoutCameraView,
    panoramaUv,
    probeAtlasUv,
    reflectionMip,
    haltonSequence,
    resolveVolumeStack,
    scenePost,
    sceneLightData,
    smhTint,
    selectReflectionProbe,
    spotAttenuation,
    sceneGrade,
    sceneLayoutOptions,
    sceneRootTransform,
    sceneSphereFog,
    shadeSH9,
    validateSceneSidecar,
    volumeContains,
} from '../gakumas-scene-core.js';

const close = (actual, expected, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const closeArray = (actual, expected, epsilon = 1e-6) => expected.forEach((value, index) => close(actual[index], value, epsilon));

test('validateSceneSidecar reports missing parts in Chinese', () => {
    assert.deepEqual(validateSceneSidecar({ format: 'gakumas-scene-export', glb: 'scene.glb', lightmapSettings: { lightmaps: [] }, layouts: { a: {} } }), []);
    const errors = validateSceneSidecar({});
    assert.equal(errors.length, 4);
    assert.ok(errors.every(message => /[\u4e00-\u9fff]/.test(message)));
});

test('sceneRootTransform puts the actor at the origin facing +Z', () => {
    const actor = { position: [3, 0.5, -2], forward: [1, 0, 0] };
    const root = sceneRootTransform(actor, 12.5);
    closeArray(applyRootTransform(root, actor.position), [0, 0, 0]);
    closeArray(applyRootRotation(root, actor.forward), [0, 0, 1]);
    const ahead = applyRootTransform(root, [4, 0.5, -2]);
    closeArray(ahead, [0, 0, 12.5]);
});

test('layoutCameraView keeps the game camera direction and aims near the actor', () => {
    const layout = {
        camera: { position: [0, 1.4, 3], forward: [0, 0, -1], fov: 50.83, near: 0.1, far: 300 },
        actors: [{ position: [0, 0, 0], forward: [0, 0, 1] }],
    };
    const root = sceneRootTransform(layout.actors[0], 12.5);
    const view = layoutCameraView(layout, root, 1);
    closeArray(view.position, [0, 17.5, 37.5]);
    closeArray(view.target, [0, 17.5, 0]);
    assert.equal(view.fov, 50.83);
});

test('volumeContains tests local boxes through the column-major matrix', () => {
    const matrix = [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
    const volume = { global: false, matrix, colliders: [{ center: [0, 0, 0], size: [1, 1, 1] }] };
    assert.equal(volumeContains(volume, [10.9, 0, 0]), true);
    assert.equal(volumeContains(volume, [11.1, 0, 0]), false);
    assert.equal(volumeContains({ global: true }, [999, 0, 0]), true);
});

test('haltonSequence matches the URP TemporalAA series', () => {
    close(haltonSequence(1, 2), 0.5);
    close(haltonSequence(2, 2), 0.25);
    close(haltonSequence(1, 3), 1 / 3);
    close(haltonSequence((0 & 1023) + 1, 2) - 0.5, 0);
});

test('resolveVolumeStack applies defaults then volumes by priority and weight', () => {
    const volumes = [
        { path: 'Local', global: false, priority: 10, weight: 0.5, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], colliders: [{ center: [0, 0, 0], size: [2, 2, 2] }], profile: { components: { ColorAdjustments: { active: 1, postExposure: { override: true, value: 1 } } } } },
        { path: 'Global', global: true, priority: 5, weight: 1, profile: { components: { ColorAdjustments: { active: 1, postExposure: { override: true, value: -1 }, contrast: { override: false, value: 3 } } } } },
        { path: 'Off', global: true, priority: 20, weight: 1, profile: { components: { ColorAdjustments: { active: 0, postExposure: { override: true, value: 9 } } } } },
    ];
    const inside = resolveVolumeStack(volumes, [0, 0, 0]);
    assert.deepEqual(inside.volumes, ['Global', 'Local', 'Off']);
    close(inside.stack.ColorAdjustments.postExposure, 0);
    assert.equal(inside.stack.ColorAdjustments.contrast, 3);
    const outside = resolveVolumeStack(volumes, [5, 0, 0]);
    close(outside.stack.ColorAdjustments.postExposure, -1);
    assert.equal(inside.activeComponents.ColorAdjustments, true);
});

test('scenePost enables only components the volume stack turned on', () => {
    const volumes = [{
        path: 'Post',
        global: true,
        priority: 0,
        weight: 1,
        profile: {
            components: {
                VLBloom: { active: 1, intensity: { override: true, value: 2 }, threshold: { override: true, value: 0.95 }, diffusion: { override: true, value: 6 }, color: { override: true, value: { r: 1, g: 1, b: 1, a: 1 } } },
                Vignette: { active: 0, intensity: { override: true, value: 0.4 }, smoothness: { override: true, value: 0.8 }, center: { override: true, value: { x: 0.5, y: 0.5 } }, color: { override: true, value: { r: 0, g: 0, b: 0, a: 1 } } },
            },
        },
    }];
    const { stack, activeComponents } = resolveVolumeStack(volumes, [0, 0, 0]);
    const post = scenePost(stack, activeComponents);
    assert.equal(post.bloom.enabled, true);
    assert.equal(post.bloom.intensity, 2);
    assert.equal(post.bloom.threshold, 0.95);
    assert.equal(post.vignette.enabled, false);
    assert.equal(scenePost(stack, {}).bloom.enabled, false);
});

test('sceneGrade converts URP parameters', () => {
    const grade = sceneGrade({
        ColorAdjustments: { postExposure: -1, contrast: 50, saturation: -20, colorFilter: { r: 1, g: 1, b: 1, a: 1 } },
        VLTonemapping: { mode: 5, gtLinearSectionStart: 0.9, gtLinearSelectionLength: 0.5, gtContrast: 1, gtBlackBrightness: 1 },
        VLLightmapVolume: { color: { r: 1, g: 1, b: 1, a: 1 }, intensity: 0.5 },
    });
    close(grade.exposure, 0.5);
    close(grade.contrast, 1.5);
    close(grade.saturation, 0.8);
    assert.equal(grade.tone.enabled, true);
    closeArray(grade.lightmapTint, [0.5, 0.5, 0.5]);
});

test('gtTonemap is linear in the middle and saturates at the shoulder', () => {
    const params = { linearStart: 0.22, linearLength: 0.4, contrast: 1, black: 1.33 };
    close(gtTonemap(0.4, params), 0.4);
    assert.ok(gtTonemap(10, params) < 1);
    assert.ok(gtTonemap(10, params) > 0.99);
    assert.ok(gtTonemap(2, params) < gtTonemap(3, params));
});

test('shadeSH9 evaluates the constant and linear bands', () => {
    const sh = new Array(27).fill(0);
    sh[0] = 0.5; sh[9] = 0.5; sh[18] = 0.5;
    sh[1] = 0.25; sh[10] = 0.25; sh[19] = 0.25;
    closeArray(shadeSH9(sh, [0, 1, 0]), [0.75, 0.75, 0.75]);
    closeArray(shadeSH9(sh, [0, -1, 0]), [0.25, 0.25, 0.25]);
});

test('decalUv mirrors local X back to Unity and flips V', () => {
    closeArray(decalUv(-0.5, -0.5), [1, 1]);
    closeArray(decalUv(0.5, 0.5), [0, 0]);
    closeArray(decalUv(0, 0, [0.5, 0.5], [0.25, 0.25]), [0.5, 0.5]);
});

test('panoramaUv maps up to the top row and wraps with rotation', () => {
    close(panoramaUv([0, 1, 0])[1], 0);
    close(panoramaUv([0, -1, 0])[1], 1);
    const a = panoramaUv([0, 0, 1], 0)[0];
    const b = panoramaUv([0, 0, 1], 90)[0];
    close(Math.abs(a - b), 0.25);
});

test('spotAttenuation matches the URP cone ramp', () => {
    const [scale, offset] = spotAttenuation(60, 30);
    const outer = Math.cos(Math.PI / 6);
    const inner = Math.cos(Math.PI / 12);
    close(outer * scale + offset, 0);
    close(inner * scale + offset, 1);
});

test('smhTint linearises the colour and applies the URP weight offset', () => {
    assert.deepEqual(smhTint(undefined), [1, 1, 1]);
    const tint = smhTint({ x: 0.5, y: 1, z: 0, w: 0.25 });
    assert.ok(Math.abs(tint[0] - (0.214041 + 1)) < 1e-4);
    assert.equal(tint[1], 2);
    assert.equal(tint[2], 1);
    assert.deepEqual(smhTint({ x: 1, y: 1, z: 1, w: -0.5 }), [0.5, 0.5, 0.5]);
});

test('sceneSphereFog flips the Unity centre and stays off without density', () => {
    assert.equal(sceneSphereFog({}).enabled, false);
    const fog = sceneSphereFog({ SphereFog: { density: 0.87, maxAmount: 0.7, radius: 75, position: { x: 12, y: -35, z: 86 }, color: { r: 1, g: 0, b: 0.5 } } });
    assert.equal(fog.enabled, true);
    assert.deepEqual(fog.center, [-12, -35, 86]);
    assert.equal(fog.radius, 75);
    assert.equal(fog.maxAmount, 0.7);
    assert.equal(fog.color[0], 1);
    assert.ok(Math.abs(fog.color[2] - 0.214041) < 1e-4);
});

test('sceneLightData carries per-light specular strength', () => {
    const light = { enabled: true, type: 'directional', intensity: 1, colorLinear: [1, 1, 1], position: [0, 0, 0], specularStrength: 0.1 };
    assert.equal(sceneLightData([light]).entries[0].specular, 0.1);
    assert.equal(sceneLightData([{ ...light, specularStrength: undefined }]).entries[0].specular, 1);
});

test('sceneLightData skips baked lights and keeps shadowmask channels for mixed lights', () => {
    const lights = [
        { path: 'sun', type: 'directional', enabled: true, bakeType: 'mixed', mixedLightingMode: 'shadowmask', shadowMaskChannel: 0, intensity: 2, color: [1, 1, 1, 1], colorLinear: [1, 0.5, 0.25, 1], position: [0, 3, 0], forward: [0, -1, 0] },
        { path: 'baked', type: 'point', enabled: true, bakeType: 'baked', intensity: 5, color: [1, 1, 1, 1], position: [0, 0, 0] },
        { path: 'lamp', type: 'point', enabled: true, bakeType: 'realtime', shadowMaskChannel: 2, intensity: 3, range: 2, color: [1, 1, 1, 1], position: [1, 2, 3] },
        { path: 'off', type: 'spot', enabled: false, bakeType: 'mixed', intensity: 1, color: [1, 1, 1, 1], position: [0, 0, 0] },
    ];
    const { count, entries } = sceneLightData(lights);
    assert.equal(count, 2);
    assert.deepEqual(entries[0].color, [2, 1, 0.5]);
    assert.equal(entries[0].params[3], 0);
    assert.equal(entries[1].position[3], 1);
    close(entries[1].params[0], 0.25);
    assert.equal(entries[1].params[3], -1);
});

test('selectReflectionProbe prefers the containing box, then importance and size', () => {
    const atlas = { file: 'x' };
    const room = { position: [0, 1, 0], boxOffset: [0, 0, 0], boxSize: [10, 4, 10], importance: 1, atlas };
    const monitor = { position: [2, 1, 2], boxOffset: [0, 0, 0], boxSize: [1, 1, 1], importance: 1, atlas };
    const outside = { position: [0, 1, -20], boxOffset: [0, 0, 0], boxSize: [20, 4, 4], importance: 1, atlas };
    const probes = [room, monitor, outside];
    assert.equal(selectReflectionProbe(probes, [2, 1, 2]), 1);
    assert.equal(selectReflectionProbe(probes, [-3, 1, -3]), 0);
    assert.equal(selectReflectionProbe(probes, [0, 1, -30]), 2);
    assert.equal(selectReflectionProbe([{ ...room, atlas: null }], [0, 0, 0]), -1);
});

test('reflectionMip and probeAtlasUv follow the Unity conventions', () => {
    close(reflectionMip(0), 0);
    close(reflectionMip(1), 6);
    close(probeAtlasUv([0, 1, 0])[1], 0);
    close(probeAtlasUv([-1, 0, 0])[0], 0);
    close(probeAtlasUv([0, 0, 1])[0], 0.25);
});

test('sceneLayoutOptions labels known layouts in Chinese', () => {
    const options = sceneLayoutOptions({ layouts: { 'home-commu': {}, custom: {} } });
    assert.deepEqual(options, [{ id: 'home-commu', label: '交流（home-commu）' }, { id: 'custom', label: 'custom' }]);
});
