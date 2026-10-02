import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import { SecondaryMotion, QUARTZ_HUMANOID_UPLEG } from '../gakumas-secondary-motion.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ttmr-casl-skirt-skeleton.json', import.meta.url), 'utf8'));
const profile = JSON.parse(readFileSync(new URL('../secondary-motion-profiles/ttmr-casl.json', import.meta.url), 'utf8'));

function makeActor(table) {
    const nodes = fixture.nodes.map(node => {
        const bone = new THREE.Bone();
        bone.name = node.name;
        bone.position.fromArray(node.translation || [0, 0, 0]);
        bone.quaternion.fromArray(node.rotation || [0, 0, 0, 1]);
        bone.scale.fromArray(node.scale || [1, 1, 1]);
        return bone;
    });
    const parented = new Set();
    fixture.nodes.forEach((node, index) => {
        for (const child of node.children || []) {
            nodes[index].add(nodes[child]);
            parented.add(child);
        }
    });
    const root = new THREE.Object3D();
    root.scale.setScalar(12.5);
    nodes.forEach((node, index) => { if (!parented.has(index)) root.add(node); });
    root.updateMatrixWorld(true);
    const rest = nodes.map(bone => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
    const motion = new SecondaryMotion(table);
    motion.worldScale = 12.5;
    motion.bind(rest);
    return { root, rest, byName: new Map(nodes.map(bone => [bone.name, bone])), motion };
}

function setPose(actor, degrees, roll = 0) {
    actor.motion.restoreBeforeAnimation();
    for (const side of ['Left', 'Right']) {
        const thigh = actor.byName.get(`${side}UpLeg`);
        const rest = actor.rest.find(entry => entry.bone === thigh);
        thigh.quaternion.copy(rest.quaternion).premultiply(new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(degrees),
        ));
        if (roll) thigh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
    }
    actor.root.updateMatrixWorld(true);
    actor.motion.update(1 / 60);
    actor.root.updateMatrixWorld(true);
}

function noForceTable() {
    return {
        ...profile,
        nativePrewarmSteps: 0,
        drivers: profile.drivers.filter(driver => driver.className === QUARTZ_HUMANOID_UPLEG),
        springs: profile.springs.filter(record => /Skirt/.test(record.bone)).map(record => ({
            ...record, mass: 0, stiffness: 0, spring: 0, pendulum: 0, damping: 1,
            collisionMask: 0, limitInfo: { useLimit: 0 },
        })),
        colliders: [], chains: [], nativeChainGeometry: { records: [] },
    };
}

test('real ttmr skirt hierarchy inherits seated thigh rotation exactly once', () => {
    const table = noForceTable();
    const actual = makeActor(table);
    const expected = makeActor({ ...table, springs: [] });
    actual.motion.startClothingTrace({ allFrames: true });
    // Ramp into/out of sitting, including roll: the UpLeg_H helper frame
    // differs from the raw thigh frame and must be included in the carrier.
    for (const angle of [0, 30, 60, 90, 90, 60, 30, 0, -45]) {
        setPose(actual, angle, 0.2);
        setPose(expected, angle, 0.2);
        if (angle === 0) {
            const trace = actual.motion.getClothingTrace();
            const skirtFrame = trace?.frames?.[0]?.bones?.find(entry => entry.bone === 'LeftFrontSkirt1_S');
            assert.equal(skirtFrame?.parameters?.gravityScale, 0, 'ttmr skirt gravity must be disabled in the native path');
        }
        for (const item of actual.motion.springs) {
            const bone = item.entry.bone;
            const reference = expected.byName.get(bone.name);
            const error = THREE.MathUtils.radToDeg(bone.getWorldQuaternion(new THREE.Quaternion()).normalize()
                .angleTo(reference.getWorldQuaternion(new THREE.Quaternion()).normalize()));
            assert.ok(error < 0.01, `${angle}° pose: ${bone.name} added ${error.toFixed(3)}° relative rotation without forces`);
            if (item.tailBone) {
                const tailError = actual.byName.get(item.tailBone).getWorldPosition(new THREE.Vector3())
                    .distanceTo(expected.byName.get(item.tailBone).getWorldPosition(new THREE.Vector3()));
                assert.ok(tailError < 1e-4, `${angle}° pose: ${bone.name} tail drifted ${tailError} stage units`);
            }
        }
    }
});
