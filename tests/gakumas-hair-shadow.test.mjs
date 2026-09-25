import test from 'node:test';
import assert from 'node:assert/strict';
import { HAIR_SHADOW_BIAS, evaluateHairShadow, hairShadowOffsetUV, viewDistanceFromDepth } from '../gakumas-hair-shadow.js';

test('only hair closer than the face counts as a bangs shadow', () => {
    assert.equal(evaluateHairShadow(1, 0.2, 0.5), 0);
    assert.equal(evaluateHairShadow(1, 0.8, 0.5), 1);
    assert.equal(evaluateHairShadow(0, 0.2, 0.5), 1);
});

test('screen offset grows when the face is closer to the camera', () => {
    const far = hairShadowOffsetUV([0.5, 0.5], [1, 0], 24, 32, [1920, 1080], 12);
    const near = hairShadowOffsetUV([0.5, 0.5], [1, 0], 8, 32, [1920, 1080], 12);
    assert.ok(near[0] > far[0]);
    assert.ok(far[0] > 0.5);
    assert.equal(hairShadowOffsetUV([0.99, 0.5], [1, 0], 8, 80, [1920, 1080], 12)[0], 1);
});

test('depth converts back to linear view distance at both clip planes', () => {
    const near = 0.2;
    const far = 2000;
    assert.ok(Math.abs(viewDistanceFromDepth(0, near, far) - near) < 1e-9);
    assert.ok(Math.abs(viewDistanceFromDepth(1, near, far) - far) < 1e-6);
    assert.ok(viewDistanceFromDepth(0.99, near, far) > viewDistanceFromDepth(0.98, near, far));
});

test('bangs shadow survives at camera distance where window depth would collapse', () => {
    const near = 0.2;
    const far = 2000;
    // Bangs 0.3 world units in front of the forehead, seen from far away. In
    // window depth the two samples differ by far less than the old 0.0004 bias.
    const depthAt = distance => (far - (near * far) / distance) / (far - near);
    for (const distance of [9, 30, 120]) {
        const face = depthAt(distance);
        const hair = depthAt(distance - 0.3);
        assert.ok(Math.abs(face - hair) < 0.0008, `window depth gap unexpectedly large at ${distance}`);
        const faceLinear = viewDistanceFromDepth(face, near, far);
        const hairLinear = viewDistanceFromDepth(hair, near, far);
        assert.equal(evaluateHairShadow(1, hairLinear, faceLinear, HAIR_SHADOW_BIAS), 0, `lost the bangs shadow at ${distance}`);
    }
});
