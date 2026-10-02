import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    firstChildBone,
    usesModelingHairRest,
    usesRenderedChildCollision,
    tailFromRenderedCorrection,
    hairRestRotationTargets,
    rebaseHairRestBones,
    rebaseHairAnimationTracks,
} from '../gakumas-secondary-motion.js';

const here = dirname(fileURLToPath(import.meta.url));
const profileDir = resolve(here, '../secondary-motion-profiles');
const hski = JSON.parse(readFileSync(resolve(profileDir, 'hski.json'), 'utf8'));
const otherProfiles = readdirSync(profileDir)
    .filter(name => name.endsWith('.json') && name !== 'hski.json')
    .map(name => [name, JSON.parse(readFileSync(resolve(profileDir, name), 'utf8'))]);

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const len = a => Math.hypot(...a);
const angleDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))) * 180 / Math.PI;

test('rendered-child collision is opt-in per hair bone', () => {
    const hair = { bone: 'LeftHairSide2_S', part: 'hair' };
    assert.equal(usesRenderedChildCollision(hair, null), false);
    assert.equal(usesRenderedChildCollision(hair, {}), false);
    assert.equal(usesRenderedChildCollision(hair, { hairCollisionAtRenderedChild: true }), false);
    const table = { hairCollisionAtRenderedChild: { bones: ['LeftHairSide2_S'] } };
    assert.equal(usesRenderedChildCollision(hair, table), true);
    assert.equal(usesRenderedChildCollision({ bone: 'RightHairSide2_S', part: 'hair' }, table), false);
    assert.equal(usesRenderedChildCollision({ bone: 'LeftHairSide2_S', part: 'skirt' }, table), false);
});

test('only hski opts in, for the two HairSide2 springs, with a stage note', () => {
    assert.deepEqual(hski.hairCollisionAtRenderedChild, { bones: ['LeftHairSide2_S', 'RightHairSide2_S'] });
    assert.equal(typeof hski.stageAdaptationNotes?.hairCollisionAtRenderedChild, 'string');
    assert.equal(hski.useModelingHairRestPose, false);
    assert.equal(usesModelingHairRest({ bone: 'LeftHairSide2_S', part: 'hair' }, hski), false);
    for (const [name, profile] of otherProfiles) assert.equal(profile.hairCollisionAtRenderedChild, undefined, name);
    // Radii of the listed springs are the native ones (no enlargement).
    const byBone = new Map(hski.springs.map(r => [r.bone, r]));
    assert.ok(Math.abs(byBone.get('LeftHairSide2_S').particleRadius - 0.005) < 1e-6);
    assert.ok(Math.abs(byBone.get('RightHairSide2_S').particleRadius - 0.01) < 1e-6);
});

function quatMul(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}
function quatRot(q, v) {
    const u = [q[0], q[1], q[2]];
    const cross = (p, r) => [p[1] * r[2] - p[2] * r[1], p[2] * r[0] - p[0] * r[2], p[0] * r[1] - p[1] * r[0]];
    const t = cross(u, v).map(value => value * 2);
    const last = cross(u, t);
    return v.map((value, index) => value + t[index] * q[3] + last[index]);
}
function worldOf(bone, poses) {
    const parent = bone.parent ? poses.get(bone.parent) : { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
    return {
        pos: parent.pos.map((value, index) => value + quatRot(parent.quat, bone.position)[index]),
        quat: quatMul(parent.quat, bone.quaternion),
    };
}

test('hair rest rebase is hski-only and keeps joint positions', () => {
    assert.equal(hski.hairRestRotationRebase, true);
    for (const [name, profile] of otherProfiles) assert.equal(profile.hairRestRotationRebase, undefined, name);
    const targets = hairRestRotationTargets(hski);
    assert.ok(targets.has('LeftHairSide1_S'));
    assert.equal(targets.has('LeftFrontSkirt_A'), false);
    const unity = hski.springs.find(record => record.bone === 'LeftHairSide1_S').modelingLocalTx.rotation;
    const converted = targets.get('LeftHairSide1_S');
    assert.ok(Math.abs(converted[0] + unity[0]) < 1e-6);
    assert.ok(Math.abs(converted[2] + unity[2]) < 1e-6);

    const root = { name: 'Head', parent: null, position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
    const hair = { name: 'LeftHairSide1_S', parent: root, position: [1, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
    const end = { name: 'LeftHairSide2_S', parent: hair, position: [0, 0, 2], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
    const yaw90 = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];
    const before = new Map([[root, worldOf(root, new Map())]]);
    before.set(hair, worldOf(hair, before));
    before.set(end, worldOf(end, before));
    const changed = rebaseHairRestBones([end, hair, root], new Map([['LeftHairSide1_S', yaw90]]));
    assert.deepEqual(changed.map(item => item.name), ['LeftHairSide1_S']);
    const clip = { tracks: [{ name: '.bones[LeftHairSide1_S].quaternion', values: [...changed[0].from, 0, 0, 0, 1] }] };
    assert.equal(rebaseHairAnimationTracks(clip, changed), 1);
    assert.ok(Math.abs(Math.abs(dot(clip.tracks[0].values.slice(0, 4), changed[0].to)) - 1) < 1e-6);
    const after = new Map([[root, worldOf(root, new Map())]]);
    after.set(hair, worldOf(hair, after));
    after.set(end, worldOf(end, after));
    assert.ok(len(sub(after.get(hair).pos, before.get(hair).pos)) < 1e-6);
    assert.ok(len(sub(after.get(end).pos, before.get(end).pos)) < 1e-6);
    assert.ok(Math.abs(Math.abs(dot(after.get(hair).quat, yaw90)) - 1) < 1e-6);
    assert.ok(Math.abs(Math.abs(dot(after.get(end).quat, before.get(end).quat)) - 1) < 1e-6);
    assert.deepEqual([...hairRestRotationTargets({ hairRestRotationRebase: false, springs: hski.springs }).keys()], []);
});

test('hair tail uses the parented PMX child when the next numbered bone is not its child', () => {
    const end = { name: 'LeftHairSide4_S_End', isBone: true, children: [] };
    const bone = { name: 'LeftHairSide2_S', isBone: true, children: [end] };
    end.parent = bone;
    const skipped = { name: 'LeftHairSide3_S', isBone: true, parent: { name: 'Other' }, children: [] };
    const byName = new Map([
        ['LeftHairSide3_S', { bone: skipped }],
        ['LeftHairSide4_S_End', { bone: end }],
    ]);
    assert.equal(firstChildBone(bone, byName), end);

    const sequential = { name: 'CenterBackHair2_S', isBone: true, children: [] };
    const root = { name: 'CenterBackHair1_S', isBone: true, children: [sequential] };
    sequential.parent = root;
    assert.equal(firstChildBone(root, new Map([['CenterBackHair2_S', { bone: sequential }]])), sequential);
});

test('tail follows the rendered-child correction by the same rotation and keeps its length', () => {
    const origin = [1, 2, 3];
    const tail = [1.2, 1.1, 3.1];
    const restLength = len(sub(tail, origin));
    const renderedBefore = [1.35, 1.15, 3.05];
    assert.deepEqual(tailFromRenderedCorrection(origin, tail, renderedBefore, renderedBefore, restLength).map(v => +v.toFixed(12)), tail.map(v => +v.toFixed(12)));
    const renderedAfter = [1.5, 1.3, 3.2];
    const out = tailFromRenderedCorrection(origin, tail, renderedBefore, renderedAfter, restLength);
    assert.ok(Math.abs(len(sub(out, origin)) - restLength) < 1e-9);
    // The angle between tail and rendered child is a rigid bone property.
    const before = angleDeg(sub(tail, origin), sub(renderedBefore, origin));
    const after = angleDeg(sub(out, origin), sub(renderedAfter, origin));
    assert.ok(Math.abs(before - after) < 1e-6, `${before} vs ${after}`);
    const turnRendered = angleDeg(sub(renderedBefore, origin), sub(renderedAfter, origin));
    const turnTail = angleDeg(sub(tail, origin), sub(out, origin));
    assert.ok(turnTail <= turnRendered + 1e-6);
});
