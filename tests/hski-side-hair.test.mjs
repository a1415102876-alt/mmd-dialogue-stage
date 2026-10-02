import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    nativeParticleLimitFrame,
    clampExtraByNativeParticleLimits,
    nativeParticleSwing,
    pendulumGravityFactor,
    seedsInitialRotationOffset,
} from '../gakumas-secondary-motion.js';

const here = dirname(fileURLToPath(import.meta.url));
const profileDir = resolve(here, '../secondary-motion-profiles');
const hski = JSON.parse(readFileSync(resolve(profileDir, 'hski.json'), 'utf8'));
const byIndex = new Map(hski.springs.filter(r => Number.isInteger(r.nativeDynamicIndex)).map(r => [r.nativeDynamicIndex, r]));
const byBone = new Map(hski.springs.map(r => [r.bone, r]));

// Unity -> three is an x-mirror for positions.
const toThree = v => [-v[0], v[1], v[2]];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const len = a => Math.hypot(...a);
const norm = a => a.map(v => v / len(a));
function rot(q, v) {
    const [x, y, z, w] = q;
    const u = [x, y, z];
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const t = cr(u, v).map(k => 2 * k);
    const ut = cr(u, t);
    return v.map((vi, i) => vi + w * t[i] + ut[i]);
}
function segmentTail(parent, child) {
    return toThree(sub(child.modelingWorldPosition, parent.modelingWorldPosition));
}
function frameFor(parentName, childName) {
    const parent = byBone.get(parentName);
    const child = byBone.get(childName);
    return { parent, child, tail: segmentTail(parent, child), frame: nativeParticleLimitFrame(parent, child, byIndex, segmentTail(parent, child)) };
}
// Native-local swing vector (degrees) -> stage extra quaternion (three bone-local).
function extraFromLocal(frame, local) {
    const u = rot(frame.unity, local);
    const w = rot(frame.fix, [u[0], -u[1], -u[2]]);
    const angle = len(w);
    const half = angle * Math.PI / 360;
    return [...w.map(k => k / angle * Math.sin(half)), Math.cos(half)];
}

test('hski opts into native particle-owned hair limits; no other profile changes behaviour', () => {
    assert.equal(hski.nativeParticleHairLimits, true);
    for (const file of readdirSync(profileDir).filter(name => name.endsWith('.json') && name !== 'hski.json')) {
        const profile = JSON.parse(readFileSync(resolve(profileDir, file), 'utf8'));
        assert.notEqual(profile.nativeParticleHairLimits, true, file);
    }
    assert.deepEqual(clampExtraByNativeParticleLimits([0, 0.1, 0, 0.995], null), [0, 0.1, 0, 0.995]);
});

test('native boneAxis of every hski hair particle points from its native parent (frame evidence)', () => {
    let segments = 0;
    for (const child of hski.springs.filter(r => r.part === 'hair')) {
        const parent = byIndex.get(child.nativeParentIndex);
        if (!parent) continue;
        const frame = nativeParticleLimitFrame(parent, child, byIndex, segmentTail(parent, child));
        assert.ok(frame, `${parent.bone} -> ${child.bone}`);
        const fixDegrees = 2 * Math.acos(Math.min(1, Math.abs(frame.fix[3]))) * 180 / Math.PI;
        assert.ok(fixDegrees < 0.01, `${parent.bone} -> ${child.bone}: ${fixDegrees}`);
        assert.equal(frame.limitInfo, child.limitInfo);
        segments++;
    }
    assert.equal(segments, 73);
});

test('the zero bound of axisZ is the swing into the head for bangs, front-side and side hair', () => {
    const headCentre = [0, 0.07, 0];
    const pairs = [
        ['CenterFrontHair1_S', 'CenterFrontHair2_S_End'],
        ['RightFrontHair2_S', 'RightFrontHair3_S_End'],
        ['LeftFrontSideLHair2_S', 'LeftFrontSideLHair3_S_End'],
        ['RightFrontSideRHair2_S', 'RightFrontSideRHair3_S_End'],
        ['LeftHairSide2_S', 'LeftHairSide4_S_End'],
        ['RightHairSide2_S', 'RightHairSide4_S_End'],
        ['RightHairSideSub2_S', 'RightHairSideSub3_S_End'],
    ];
    for (const [p, c] of pairs) {
        const { parent, child, tail, frame } = frameFor(p, c);
        assert.equal(child.limitInfo.axisZ[1], 0, c);
        const inward = norm(sub(toThree(headCentre), toThree(child.modelingWorldPosition)));
        const moved = rot(extraFromLocal(frame, [0, 0, 10]), tail);
        assert.ok(dot(norm(sub(moved, tail)), inward) > 0.6, `${p}: +Z should move the tail into the head`);
        assert.ok(parent);
    }
});

test('bangs cannot rotate into the forehead but keep their outward range', () => {
    const { frame } = frameFor('CenterFrontHair1_S', 'CenterFrontHair2_S_End');
    const into = nativeParticleSwing(clampExtraByNativeParticleLimits(extraFromLocal(frame, [0, 0, 23.5]), frame), frame);
    assert.ok(Math.abs(into[2]) < 1e-6);
    const out = nativeParticleSwing(clampExtraByNativeParticleLimits(extraFromLocal(frame, [0, 0, -20]), frame), frame);
    assert.ok(Math.abs(out[2] + 20) < 1e-6);
    const sideways = nativeParticleSwing(clampExtraByNativeParticleLimits(extraFromLocal(frame, [0, 25, 0]), frame), frame);
    assert.ok(Math.abs(sideways[1] - 10) < 1e-6);
});

test('right side-hair tail uses the tail particle limits, not the old symmetric cone', () => {
    const { frame } = frameFor('RightHairSide2_S', 'RightHairSide4_S_End');
    assert.deepEqual(frame.limitInfo.axisY, [-10, 10]);
    // Measured head-up stage swing before the fix: Y -46 deg against a native [-10, 10] range.
    const limited = nativeParticleSwing(clampExtraByNativeParticleLimits(extraFromLocal(frame, [0, -46, 8.6]), frame), frame);
    assert.ok(Math.abs(limited[1] + 10) < 1e-6);
    assert.ok(Math.abs(limited[2]) < 1e-6);
    assert.ok(Math.abs(limited[0]) < 1e-6);
});

test('v2: hski scales hair gravity by the native tail-particle pendulum; other profiles are unaffected', () => {
    assert.deepEqual(hski.hairGravityFromPendulum, { reference: 0.009 });
    for (const file of readdirSync(profileDir).filter(name => name.endsWith('.json') && name !== 'hski.json')) {
        const profile = JSON.parse(readFileSync(resolve(profileDir, file), 'utf8'));
        assert.equal(profile.hairGravityFromPendulum, undefined, file);
        assert.notEqual(profile.skipHairInitialRotationOffset, true, file);
    }
    const factor = (bone, tail) => pendulumGravityFactor(byBone.get(bone), byBone.get(tail), hski);
    assert.ok(Math.abs(factor('RightHairSide2_S', 'RightHairSide4_S_End') - 0.004 / 0.009) < 1e-3);
    assert.ok(Math.abs(factor('RightFrontSideRHair2_S', 'RightFrontSideRHair3_S_End') - 0.001 / 0.009) < 1e-3);
    assert.ok(Math.abs(factor('CenterFrontHair1_S', 'CenterFrontHair2_S_End') - 0.006 / 0.009) < 1e-3);
    // Roots use the moved particle (pendulum 0 on the root itself).
    assert.ok(factor('RightHairSide1_S', 'RightHairSide2_S') > 0.4);
    for (const record of hski.springs.filter(r => r.part === 'hair')) {
        const value = pendulumGravityFactor(record, null, hski);
        assert.ok(value >= 0 && value <= 1, record.bone);
    }
    assert.equal(pendulumGravityFactor(byBone.get('LeftFrontSkirt1_S') || { part: 'body', pendulum: 0.005 }, null, hski), 1);
    assert.equal(pendulumGravityFactor(byBone.get('RightHairSide2_S'), null, {}), 1);
});

test('v2: hair springs skip the captured initialRotationOffset seed; skirts keep it', () => {
    assert.equal(hski.skipHairInitialRotationOffset, true);
    assert.equal(seedsInitialRotationOffset(byBone.get('RightHairSide2_S'), hski), false);
    assert.equal(seedsInitialRotationOffset({ bone: 'LeftFrontSkirt1_S', part: 'body' }, hski), true);
    assert.equal(seedsInitialRotationOffset(byBone.get('RightHairSide2_S'), {}), true);
    // Evidence: the offset applied in PMX bone-local axes swings the modeled
    // RightHairSide2 -> 4 tail by more than 15 degrees (2.4 cm), although the
    // native capture keeps that tail within 0.7 cm of modeling rest.
    const record = byBone.get('RightHairSide2_S');
    const tail = segmentTail(record, byBone.get('RightHairSide4_S_End'));
    const moved = rot(record.initialRotationOffset, tail);
    const degrees = Math.acos(dot(norm(moved), norm(tail))) * 180 / Math.PI;
    assert.ok(degrees > 15, String(degrees));
});
