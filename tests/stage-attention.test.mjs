import test from 'node:test';
import assert from 'node:assert/strict';
import { Bone } from '../vendor/three/build/three.module.js';
import { StageAttentionController } from '../stage-attention.js';

test('stage attention resolves actor targets from stage positions', () => {
    assert.deepEqual(StageAttentionController.resolveTarget('ttmr', 'hmsz', { ttmr: 'left', hmsz: 'right' }), { x: 1, y: 0 });
    assert.deepEqual(StageAttentionController.resolveTarget('ttmr', 'camera', { ttmr: 'left' }), { x: 0, y: 0 });
});

test('stage attention applies a bounded additive yaw and restores it cleanly', () => {
    const model = new Bone();
    const controller = new StageAttentionController();
    controller.bind(model);
    controller.setTarget('hmsz', { x: 1, y: 0 });
    controller.update(1);
    const turned = model.quaternion.toArray();
    assert.ok(Math.abs(turned[1]) > 0.01);
    controller.clearTarget();
    controller.update(1);
    const restored = model.quaternion.toArray();
    assert.ok(Math.abs(restored[0]) < 1e-5);
    assert.ok(Math.abs(restored[1]) < 1e-5);
    assert.ok(Math.abs(restored[2]) < 1e-5);
    assert.ok(Math.abs(restored[3] - 1) < 1e-5);
});
