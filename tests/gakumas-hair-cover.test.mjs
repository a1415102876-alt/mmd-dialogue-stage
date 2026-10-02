import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/build/three.module.js';
import { HairCoverStage, evaluateHairCoverAlpha } from '../gakumas-hair-cover.js';
import { injectActorShader } from '../gakumas-shader.js';

function fixture() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(27), 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(27), 3));
    geometry.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    geometry.addGroup(0, 3, 0);
    geometry.addGroup(3, 3, 1);
    geometry.addGroup(6, 3, 2);
    const materials = ['m_bdy', 'm_hir', 'm_hir+'].map(name => new THREE.MeshToonMaterial({ name }));
    materials[1].map = new THREE.Texture();
    const mesh = new THREE.SkinnedMesh(geometry, materials);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const camera = new THREE.PerspectiveCamera();
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const stage = new HairCoverStage();
    stage.add(mesh, materials[0], 0, {}, 't_chr_test_bdy_col.png');
    stage.add(mesh, materials[1], 1, {}, 't_chr_test_hir_col_alp.png');
    stage.add(mesh, materials[2], 2, {}, 't_chr_test_hir_sph.png');
    return { stage, mesh, scene, camera, materials, geometry };
}

test('source formula treats texture alpha as fade weight, not coverage', () => {
    assert.equal(evaluateHairCoverAlpha(1, 0, 1), 0);
    assert.equal(evaluateHairCoverAlpha(1, 0, 0), 1);
    assert.equal(evaluateHairCoverAlpha(1, 0, 0.5), 0.5);
    assert.equal(evaluateHairCoverAlpha(0, 0, 1), 1);
    assert.equal(evaluateHairCoverAlpha(-1, 0, 1), 1);
    assert.equal(evaluateHairCoverAlpha(1, 1, 1), 1);
    assert.equal(evaluateHairCoverAlpha(1, 0, 1, 0.35), 0.35);
    assert.equal(evaluateHairCoverAlpha(0, 0, 1, 0.35), 1);
});

test('cover shader only fades m_hir and leaves the m_hir+ highlight branch to its own pass', () => {
    const shader = {
        uniforms: {},
        vertexShader: '#include <worldpos_vertex>\n#include <begin_vertex>\n#include <project_vertex>',
        fragmentShader: '#include <alphatest_fragment>\n#include <lights_fragment_end>',
    };
    injectActorShader(shader, {});
    assert.doesNotMatch(shader.vertexShader, /gl_Position\.z -= 0\.0015 \* gl_Position\.w;/);
    assert.match(shader.fragmentShader, /#ifdef GK_HAIR_COVER_PASS[\s\S]*gkSpecMask = 0\.0;[\s\S]*#else[\s\S]*gkHairHighlight/);
    assert.match(shader.fragmentShader, /gkSpecMask \*= gkHairProp;\s*#endif\s*#endif\s*vec4 gkRamp/);
});

test('only hair has a second pass; base arrays, geometry, maps and scene stay intact', () => {
    const { stage, mesh, materials, geometry, scene, camera } = fixture();
    const groups = structuredClone(geometry.groups);
    assert.equal(stage.entries.length, 1);
    const entry = stage.entries[0];
    assert.equal(entry.mesh, mesh);
    assert.notEqual(entry.material, materials[1]);
    assert.equal(entry.material.map, materials[1].map);
    assert.equal(entry.material.opacity, 1);
    assert.equal(entry.material.depthWrite, false);
    assert.equal(entry.material.depthTest, true);
    // The model already has a high eye stencil. HairCover must leave that
    // existing ordering alone and therefore must not run a second stencil
    // test or write to the stencil buffer.
    assert.equal(entry.material.stencilWrite, false);
    assert.equal(entry.material.blendSrc, THREE.SrcAlphaFactor);
    assert.equal(entry.material.blendDst, THREE.OneMinusSrcAlphaFactor);
    assert.equal(entry.material.blendSrcAlpha, THREE.OneFactor);
    assert.equal(entry.material.blendDstAlpha, THREE.OneMinusSrcAlphaFactor);
    const draws = [];
    stage.draw({ renderBufferDirect: (...args) => draws.push(args) }, scene, camera);
    assert.equal(draws.length, 1);
    assert.equal(draws[0][2], geometry);
    assert.equal(draws[0][4], mesh);
    assert.deepEqual(draws[0][5], groups[1]);
    assert.equal(mesh.material, materials);
    assert.deepEqual(geometry.groups, groups);
    assert.equal(scene.children.length, 1);
    assert.ok(materials.every(material => material.visible));
});

test('redraws m_hir+ after HairCover so the highlight is not buried by the fade pass', () => {
    const { stage, scene, camera, mesh, materials } = fixture();
    stage.addHighlight(mesh, materials[2], 2);
    const events = [];
    const renderer = {
        render: () => {
            events.push('base');
            scene.onAfterRender(renderer, scene, camera);
        },
        renderBufferDirect: (activeCamera, activeScene, geometry, material) => {
            if (material === materials[2]) {
                assert.equal(material.depthTest, false);
                assert.equal(material.depthWrite, false);
                assert.equal(material.stencilWrite, true);
                assert.equal(material.stencilFunc, THREE.EqualStencilFunc);
                assert.equal(material.stencilRef, 64);
                assert.equal(material.stencilWriteMask, 0);
            }
            events.push(material === materials[2] ? 'highlight' : 'cover');
        },
    };
    stage.renderFrame(renderer, { enabled: false, renderOutline() {} }, scene, camera, true);
    assert.deepEqual(events, ['base', 'cover', 'highlight']);
    assert.equal(materials[2].depthTest, true);
    assert.equal(materials[2].depthWrite, true);
    assert.equal(materials[2].stencilWrite, false);
});

test('extra drawing respects visibility, camera layers and material visibility', () => {
    const { stage, mesh, scene, camera, materials } = fixture();
    let draws = 0;
    const renderer = { renderBufferDirect: () => draws++ };
    mesh.visible = false;
    stage.draw(renderer, scene, camera);
    mesh.visible = true;
    scene.visible = false;
    stage.draw(renderer, scene, camera);
    scene.visible = true;
    materials[1].visible = false;
    stage.draw(renderer, scene, camera);
    materials[1].visible = true;
    mesh.layers.set(2);
    stage.draw(renderer, scene, camera);
    assert.equal(draws, 0);
});

test('stage restores callbacks on success and failure and never runs during outline', () => {
    const { stage, scene, camera, mesh, materials, geometry } = fixture();
    const events = [];
    const original = () => events.push('base-hook');
    scene.onAfterRender = original;
    const renderer = {
        getRenderTarget: () => null,
        render: () => {
            events.push('base');
            scene.onAfterRender(renderer, scene, camera);
        },
        renderBufferDirect: () => events.push('cover'),
    };
    const outline = { enabled: true, renderOutline: () => { events.push('outline'); scene.onAfterRender(renderer, scene, camera); } };
    stage.renderFrame(renderer, outline, scene, camera, true);
    assert.deepEqual(events, ['base', 'cover', 'base-hook', 'outline', 'base-hook']);
    assert.equal(scene.onAfterRender, original);
    assert.equal(mesh.material, materials);
    events.length = 0;
    stage.renderFrame(renderer, outline, scene, camera, false);
    assert.ok(!events.includes('cover'));
    renderer.renderBufferDirect = () => { throw new Error('GPU failure'); };
    assert.throws(() => stage.renderFrame(renderer, outline, scene, camera, true), /GPU failure/);
    assert.equal(scene.onAfterRender, original);
    assert.equal(mesh.material, materials);
});

test('single-material meshes still draw when three omits the geometry group', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    geometry.setIndex([0, 1, 2]);
    const source = new THREE.MeshToonMaterial({ name: 'm_hir' });
    const mesh = new THREE.SkinnedMesh(geometry, source);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const camera = new THREE.PerspectiveCamera();
    scene.updateMatrixWorld(true);
    const stage = new HairCoverStage();
    stage.add(mesh, source, 0, {}, 't_chr_test_hir_col_alp.png');
    const draws = [];
    const renderer = {
        render: () => scene.onAfterRender(renderer, scene, camera),
        renderBufferDirect: (...args) => draws.push(args[5]),
    };
    stage.renderFrame(renderer, { enabled: false, renderOutline() {} }, scene, camera, true);
    assert.equal(draws.length, 1);
    assert.equal(draws[0].start, 0);
    assert.equal(draws[0].count, 3);
    assert.equal(stage.lastDraws.length, 1);
    assert.equal(stage.lastDraws[0].name, 'm_hir');
});

test('hair cover can draw into a color render target', () => {
    const { stage, scene, camera, mesh, geometry } = fixture();
    const events = [];
    const renderer = {
        getRenderTarget: () => ({}),
        render: () => {
            events.push('base');
            scene.onAfterRender(renderer, scene, camera);
        },
        renderBufferDirect: () => events.push('cover'),
    };
    stage.renderFrame(renderer, { enabled: false, renderOutline() {} }, scene, camera, true);
    assert.deepEqual(events, ['base', 'cover']);
});

test('disposing a pass releases only its material, never source buffers or shared textures', () => {
    const { stage, geometry, materials } = fixture();
    let released = 0;
    stage.entries[0].material.addEventListener('dispose', () => released++);
    for (const resource of [geometry, ...materials, materials[1].map]) {
        resource.addEventListener('dispose', () => assert.fail('source resource disposed'));
    }
    stage.dispose();
    assert.equal(released, 1);
    assert.equal(stage.entries.length, 0);
});

test('ShaderMaterial texture uniforms remain shared but uniform containers are isolated', () => {
    const { mesh } = fixture();
    const texture = new THREE.Texture();
    const source = new THREE.ShaderMaterial({ name: 'm_hir', uniforms: { map: { value: texture } } });
    const stage = new HairCoverStage();
    stage.add(mesh, source, 1, {}, 't_chr_test_hir_col_alp.png');
    const material = stage.entries[0].material;
    assert.notEqual(material.uniforms, source.uniforms);
    assert.notEqual(material.uniforms.map, source.uniforms.map);
    assert.equal(material.uniforms.map.value, texture);
});
