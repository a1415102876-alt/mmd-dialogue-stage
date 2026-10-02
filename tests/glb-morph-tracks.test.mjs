import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/build/three.module.js';
import { bindGlbMorphTracks } from '../glb-morph-tracks.js';

test('mixer animates eye and mouth on every primitive, including reordered indices and duplicate names', () => {
    const root = new THREE.Group();
    const meshes = Array.from({ length: 9 }, (_, i) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
        geometry.morphAttributes.position = Array.from({ length: 2 }, () => new THREE.Float32BufferAttribute([1, 0, 0], 3));
        const mesh = new THREE.Mesh(geometry);
        mesh.name = 'face';
        mesh.morphTargetDictionary = i % 2 ? { mouth_001: 0, 'b_eye.eye_001': 1 } : { 'b_eye.eye_001': 0, mouth_001: 1 };
        root.add(mesh);
        return mesh;
    });
    const clip = new THREE.AnimationClip('face', 1, [
        new THREE.NumberKeyframeTrack('.morphTargetInfluences[0]', [0, 1], [0, 1]),
        new THREE.NumberKeyframeTrack('.morphTargetInfluences[1]', [0, 1], [0, 0.6]),
    ]);
    const report = bindGlbMorphTracks(clip, { 'b_eye.eye_001': 0, mouth_001: 1 }, root);
    assert.equal(report.boundMeshes, 9);
    assert.equal(report.boundTracks, 18);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    mixer.update(0.5);
    for (const mesh of meshes) {
        assert.ok(Math.abs(mesh.morphTargetInfluences[mesh.morphTargetDictionary['b_eye.eye_001']] - 0.5) < 1e-6);
        assert.ok(Math.abs(mesh.morphTargetInfluences[mesh.morphTargetDictionary.mouth_001] - 0.3) < 1e-6);
    }
});
