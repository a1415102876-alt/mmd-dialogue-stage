import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Bone, Group, Quaternion, Vector3 } from '../vendor/three/build/three.module.js';
import {
    SecondaryMotion, RECOVERED_PHYSICS_ALGORITHM,
    nativeUnityEulerDegrees, unityEulerDegreesToQuaternion,
} from '../gakumas-secondary-motion.js';

const kotoneProfile = JSON.parse(readFileSync(new URL('../secondary-motion-profiles/fktn-casl.json', import.meta.url), 'utf8'));
const temariProfile = JSON.parse(readFileSync(new URL('../secondary-motion-profiles/ttmr-casl.json', import.meta.url), 'utf8'));

test('Kotone GLB profile explicitly enables captured clothing constraints', () => {
    assert.equal(kotoneProfile.nativeReferenceLimits, true);
    assert.equal(kotoneProfile.nativeReferenceLimitSpace, 'gltf-unity');
    assert.equal(kotoneProfile.nativeChainGeometryApplied, 44);
    assert.equal(kotoneProfile.nativeChainGeometry.records.length, 44);
    assert.equal(kotoneProfile.nativeChainGeometry.records.filter(record => record.particleBinding === 'child').length, 44);
    assert.equal(kotoneProfile.springs.filter(record => record.referenceLimitInfo?.bone
        && [...(record.referenceLimitInfo.min || []), ...(record.referenceLimitInfo.max || [])].some(Boolean)).length, 24);
});

test('Temari GLB profile keeps captured jacket and back-hair chain links separate from reference limits', () => {
    assert.equal(temariProfile.nativeDynamicGeometryApplied, 208);
    assert.equal(temariProfile.nativeChainGeometryApplied, 75);
    assert.equal(temariProfile.nativeChainGeometry.records.length, 75);
    assert.equal(temariProfile.nativeChainGeometry.records.filter(record => record.particleBinding === 'child').length, 75);
    assert.equal(temariProfile.nativeParticleHairLimits, true);
    assert.equal(temariProfile.stableHairContacts, true);
    assert.equal(temariProfile.skirtCollidesWithThigh, undefined);
    assert.deepEqual(temariProfile.nativeParticleHairLimitExcludeBones, [
        'LeftFrontTopSideHair2_S',
        'RightFrontTopSideHair2_S',
        'LeftFrontTopSideHair3_S_End',
        'RightFrontTopSideHair3_S_End',
    ]);
    assert.equal(temariProfile.nativeSkirtThighCollisionRadiusScale, 1.25);
    assert.deepEqual(temariProfile.nativeCaptureCoverage.nativeUnresolvedDynamicBones, [
        'RightArmSleeve1_S', 'RightArmSleeve2_S', 'RightArmSleeve3_S_End',
    ]);
    assert.ok(temariProfile.nativeChainGeometry.records.some(record =>
        record.sourceBone === 'RightBackSideJacket3_S'
        && record.targetBone === 'RightFrontSideJacket3_S'));
    assert.equal(temariProfile.nativeChainGeometry.records.some(record =>
        record.sourceBone === 'RightBackJacket4_S'
        && record.targetBone === 'RightFrontJacket4_S'), false);
    assert.equal(temariProfile.nativeReferenceLimits, false);
    assert.equal(temariProfile.nativeReferenceLimitCoverage.configuredRecords, 0);
    assert.equal(temariProfile.nativeCaptureCoverage.joinedChainRecords, 75);
});

test('Temari GLB profile uses the expanded runtime endpoints for symmetric leg colliders', () => {
    const byIndex = new Map(temariProfile.colliders.map(record => [record.nativeIndex, record]));
    const left = byIndex.get(6);
    const right = byIndex.get(7);
    assert.equal(temariProfile.nativeStaticGeometryApplied, 23);
    assert.deepEqual(left.offsetA.map(value => Number(value.toFixed(6))), [0.1925, 0.033, 0]);
    assert.deepEqual(left.offsetB.map(value => Number(value.toFixed(6))), [0.0375, 0.033, 0]);
    assert.deepEqual(right.offsetA.map(value => Number(value.toFixed(6))), [-0.0475, -0.033, 0]);
    assert.deepEqual(right.offsetB.map(value => Number(value.toFixed(6))), [-0.1925, -0.033, 0]);
    assert.ok(Math.abs((right.offsetA[1] ?? 0) - (right.offsetB[1] ?? 0)) < 1e-6);
    assert.ok(Math.abs((right.offsetA[0] ?? 0) - (right.offsetB[0] ?? 0)) > 0.14);
});

function fixture(enabled = true, rotatedRoot = false) {
    const root = new Group();
    const jacket = new Bone(), middle = new Bone(), end = new Bone(), skirt = new Bone();
    jacket.name = 'Jacket1_S'; middle.name = 'Jacket2_S'; end.name = 'Jacket3_S_End'; skirt.name = 'SkirtReference';
    middle.position.x = 1; end.position.x = 1;
    root.add(jacket, skirt); jacket.add(middle); middle.add(end);
    jacket.quaternion.fromArray([0, 0, -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)]);
    skirt.quaternion.fromArray([0, 0, -Math.sin(Math.PI / 18), Math.cos(Math.PI / 18)]);
    if (rotatedRoot) root.quaternion.fromArray(unityEulerDegreesToQuaternion([15, 20, 35]));
    root.updateMatrixWorld(true);
    const bones = [jacket, middle, end, skirt];
    const settings = {
        part: 'body', enabled: true, unityLocalPosition: [1, 0, 0],
        collisionMask: 0, colliderType: 4, mass: 0, pendulum: 0, damping: 1, spring: 0, stiffness: 0,
        limitInfo: { useLimit: 1, axisX: [-180, 180], axisY: [-180, 180], axisZ: [-180, 180] },
    };
    const motion = new SecondaryMotion({
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        nativePrewarmSteps: 0, nativeReferenceLimits: enabled,
        nativeReferenceLimitSpace: 'gltf-unity', skirtDriverBasis: 'gltf-unity',
        springs: [
            { ...settings, bone: jacket.name, referenceLimitInfo: { bone: { name: skirt.name }, min: [0, 0, 0], max: [0, 0, 1] } },
            { ...settings, bone: middle.name },
        ], drivers: [], colliders: [], chains: [],
    });
    motion.bind(bones.map(bone => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() })));
    return { motion, root, jacket, skirt };
}

test('reference limits constrain jacket rotation in actor space under a rotated root', () => {
    for (const rotated of [false, true]) {
        const { motion, root, jacket, skirt } = fixture(true, rotated);
        motion.update(); root.updateMatrixWorld(true);
        const inRoot = bone => root.getWorldQuaternion(new Quaternion()).invert().multiply(bone.getWorldQuaternion(new Quaternion())).toArray();
        const toUnity = q => [q[0], -q[1], -q[2], q[3]];
        const target = nativeUnityEulerDegrees(toUnity(inRoot(jacket)));
        const reference = nativeUnityEulerDegrees(toUnity(inRoot(skirt)));
        assert.ok(Math.abs(target[2] - reference[2]) < 1e-5, `root rotation leaked into reference Z: ${target[2]} vs ${reference[2]}`);
        assert.ok(motion.runtime.referenceLimitApplied > 0);
    }
});

test('reference correction carries all downstream particle states with the rendered chain', () => {
    const { motion, root } = fixture();
    for (let frame = 0; frame < 30; frame += 1) {
        motion.restoreBeforeAnimation(); motion.update(); root.updateMatrixWorld(true);
        for (const item of motion.springs) {
            const rendered = new Vector3(...item.tailLocal).applyMatrix4(item.entry.bone.matrixWorld);
            assert.ok(rendered.distanceTo(new Vector3(...item.current)) < 1e-6, `${item.record.bone} detached at frame ${frame}`);
            const solverPoint = rendered.clone().sub(root.getWorldPosition(new Vector3())).applyQuaternion(root.getWorldQuaternion(new Quaternion()).invert());
            assert.ok(solverPoint.distanceTo(new Vector3(...item.nativePosition)) < 1e-6, `${item.record.bone} native history detached at frame ${frame}`);
            assert.ok(item.speed.every(Number.isFinite));
        }
    }
});

test('profiles without verified reference-limit activation keep their previous solver behavior', () => {
    const { motion, jacket } = fixture(false);
    const original = jacket.quaternion.clone();
    motion.update();
    assert.ok(jacket.quaternion.angleTo(original) < 1e-6, 'unverified profile acquired a new reference constraint');
    assert.equal(motion.referenceLimitBindings.length, 0);
});
