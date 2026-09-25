import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/build/three.module.js';
import { readFile } from 'node:fs/promises';
import { decodeGakumasVertexColor, hasGakumasVertexColorAttribute } from '../gakumas-outline.js';

const effectSource = (await readFile(new URL('../vendor/three/examples/jsm/effects/OutlineEffect.js', import.meta.url), 'utf8'))
    .replace("from 'three'", `from '${new URL('../vendor/three/build/three.module.js', import.meta.url).href}'`);
const { OutlineEffect } = await import(`data:text/javascript;base64,${Buffer.from(effectSource).toString('base64')}`);

test('outline draw supplies missing attributes and restores source materials', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const source = mesh.material;
    source.userData.outlineParameters = { thickness: 0.0044, alpha: 0.6 };
    const scene = new THREE.Scene();
    scene.add(mesh);
    const renderer = { shadowMap: { enabled: true }, autoClear: true, render() {
        mesh.onBeforeRender(renderer, scene, null, mesh.geometry, mesh.material);
        assert.deepEqual(mesh.material.defaultAttributeValues.gakumasVertexColor, [0, 0, 0, 0]);
        assert.equal(mesh.material.uniforms.gakumasVertexColorEnabled.value, 0);
        assert.equal(mesh.material.uniforms.outlineThickness.value, 0.0044);
        assert.equal(mesh.material.uniforms.outlineAlpha.value, 0.6);
    } };
    new OutlineEffect(renderer).renderOutline(scene, new THREE.PerspectiveCamera());
    assert.equal(mesh.material, source);
    assert.equal(renderer.autoClear, true);
    assert.equal(renderer.shadowMap.enabled, true);
});

test('packed bytes decode the six authored fields independently', () => {
    for (let byte = 0; byte < 256; byte++) {
        const decoded = decodeGakumasVertexColor(new Float32Array(4).fill(byte / 255));
        const high = (byte >> 4) / 15;
        const low = (byte & 15) / 15;
        for (const [actual, expected] of [[decoded.outlineColor[0], high], [decoded.outlineColor[1], low], [decoded.outlineColor[2], high], [decoded.outlineWidth, low], [decoded.outlineOffset, high], [decoded.rampAddId, low], [decoded.rimMask, high]]) {
            assert.ok(Math.abs(actual - expected) < 0.000002, `${byte}: ${actual} != ${expected}`);
        }
    }
});

test('attribute requires an Additional UV 3 value for every vertex', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.userData.MMD = { additionalUvNum: 3 };
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute('gakumasVertexColor', new THREE.Float32BufferAttribute(new Float32Array(4), 4));
    assert.equal(hasGakumasVertexColorAttribute({ geometry }), false);
    geometry.setAttribute('gakumasVertexColor', new THREE.Float32BufferAttribute(new Float32Array(12), 4));
    assert.equal(hasGakumasVertexColorAttribute({ geometry }), true);
    geometry.userData.MMD.additionalUvNum = 2;
    assert.equal(hasGakumasVertexColorAttribute({ geometry }), false);
    assert.equal(hasGakumasVertexColorAttribute(null), false);
});

test('authored eyelash detail can be excluded from the expanded outline pass', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.material.userData.gakumasOutlineExcluded = true;
    const scene = new THREE.Scene();
    scene.add(mesh);
    const renderer = { shadowMap: { enabled: true }, autoClear: true, render() {
        mesh.onBeforeRender(renderer, scene, null, mesh.geometry, mesh.material);
        assert.equal(mesh.material.visible, false);
    } };
    new OutlineEffect(renderer).renderOutline(scene, new THREE.PerspectiveCamera());
    assert.equal(mesh.material.visible, true);
});
