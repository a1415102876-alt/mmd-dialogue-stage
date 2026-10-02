import test from 'node:test';
import assert from 'node:assert/strict';
import { Bone, Vector3 } from '../vendor/three/build/three.module.js';
import { SecondaryMotion } from '../gakumas-secondary-motion.js';

function makeMotion(withChain, nested = false) {
    const root = new Bone();
    root.name = 'Spine';
    const bones = [root];
    const springs = [];
    for (const [index, side] of ['Left', 'Right'].entries()) {
        const panel = new Bone();
        panel.name = `${side}BackJacket3_S`;
        panel.position.set(index * 4, 0, 0);
        const tip = new Bone();
        tip.name = `${side}BackJacket4_S`;
        tip.position.set(1, 0, 0);
        root.add(panel);
        panel.add(tip);
        bones.push(panel, tip);
        springs.push({ bone: panel.name, damping: 0.5, stiffness: 0, spring: 0, mass: 1, collisionMask: 0, colliderType: 4, unityLocalPosition: [0.32, 0, 0] });
        if (nested) {
            const end = new Bone();
            end.name = `${side}BackJacket5_S`;
            end.position.set(1, 0, 0);
            tip.add(end);
            bones.push(end);
            springs.push({ ...springs.at(-1), bone: tip.name });
        }
    }
    root.updateMatrixWorld(true);
    const motion = new SecondaryMotion({
        drivers: [], springs, colliders: [],
        chains: withChain ? [{ layers: (nested ? [3, 4] : [3]).map(index => ({ active: 1, around: 0, radius: 0.001, bones: springs.filter(record => record.bone.endsWith(`${index}_S`)).map(record => record.bone) })) }] : [],
    });
    motion.bind(bones.map(bone => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() })));
    motion.setTuning({ gravity: 10 });
    return motion;
}

test('a non-contact chain must preserve the already solved jacket rotation', () => {
    const independent = makeMotion(false);
    const linked = makeMotion(true);
    for (let frame = 0; frame < 120; frame += 1) {
        independent.update();
        linked.update();
        for (let index = 0; index < linked.springs.length; index += 1) {
            assert.ok(linked.springs[index].entry.bone.quaternion.angleTo(independent.springs[index].entry.bone.quaternion) < 1e-6, `chain undid the solved rotation on frame ${frame}`);
        }
    }
});

test('parent chain corrections keep child jacket particles on their rendered bones', () => {
    const motion = makeMotion(true, true);
    motion.chains[0].layers[0].radius = 1;
    for (let frame = 0; frame < 120; frame += 1) {
        motion.update();
        for (const spring of motion.springs) {
            const rendered = new Vector3(...spring.tailLocal).applyMatrix4(spring.entry.bone.matrixWorld);
            assert.ok(rendered.distanceTo(new Vector3(...spring.current)) < 1e-6, `${spring.record.bone} detached from its particle on frame ${frame}`);
        }
    }
});

test('a profile can disable ring separation without disabling spring motion', () => {
    const motion = makeMotion(true, true);
    const reference = makeMotion(false, true);
    motion.table.disableChainSeparation = true;
    motion.chains[0].layers[0].radius = 1;
    motion.update();
    reference.update();
    for (let index = 0; index < motion.springs.length; index += 1) {
        assert.ok(motion.springs[index].entry.bone.quaternion.angleTo(reference.springs[index].entry.bone.quaternion) < 1e-6, `ring separation was not disabled for ${motion.springs[index].record.bone}`);
    }
});

test('authored particle metadata must not create unverified all-pairs self collision', () => {
    const baseline = makeMotion(false, true);
    const withMetadata = makeMotion(false, true);
    for (const motion of [baseline, withMetadata]) {
        const rightPanel = motion.springs.find(item => item.record.bone === 'RightBackJacket3_S');
        rightPanel.entry.bone.position.x = 0.05;
        rightPanel.entry.bone.updateMatrixWorld(true);
        motion.reset();
        for (const spring of motion.springs) {
            spring.record.collisionMask = 64;
            spring.record.colliderType = 0;
            spring.record.particleRadius = 0.03;
        }
    }
    for (const spring of withMetadata.springs) {
        spring.record.dynamicCollider = { type: 0, collisionMask: 64, float_A: 0.03, float_B: 0.03 };
    }
    for (let frame = 0; frame < 120; frame += 1) {
        baseline.update();
        withMetadata.update();
        for (let index = 0; index < baseline.springs.length; index += 1) {
            assert.ok(withMetadata.springs[index].entry.bone.quaternion.angleTo(baseline.springs[index].entry.bone.quaternion) < 1e-6, `particle metadata introduced unverified repulsion on frame ${frame}`);
        }
    }
});

test('captured GLB chains bind named child particles to the owning spring', () => {
    const root = new Bone();
    root.name = 'Spine';
    const bones = [root];
    for (let index = 1; index <= 4; index += 1) {
        const bone = new Bone();
        bone.name = `Jacket${index}_S`;
        bone.position.set(1, 0, 0);
        (bones.at(-1)).add(bone);
        bones.push(bone);
    }
    root.updateMatrixWorld(true);
    const springs = bones.slice(1, 4).map((bone, index) => ({
        bone: bone.name,
        part: 'body',
        damping: 0.5,
        stiffness: 0,
        spring: 0,
        mass: 1,
        collisionMask: 0,
        colliderType: 4,
        particleRadius: 0.01,
        unityLocalPosition: [1, 0, 0],
        referenceLimitInfo: { bone: null, min: [0, 0, 0], max: [0, 0, 0] },
        initialRotationEuler: [0, 0, 0],
    }));
    const motion = new SecondaryMotion({
        physicsAlgorithm: 'gakumas-runtime-recovered-v1',
        drivers: [],
        springs,
        colliders: [],
        chains: [],
        nativeChainGeometry: {
            records: [{
                active: 1,
                depth: 1,
                around: 0,
                radiusA: 0.01,
                radiusB: 0.01,
                sourceBone: 'Jacket2_S',
                targetBone: 'Jacket3_S',
                particleBinding: 'child',
            }],
        },
    });
    motion.bind(bones.map(bone => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() })));
    assert.equal(motion.nativeChainLinks.length, 1);
    assert.equal(motion.nativeChainLinks[0].source.record.bone, 'Jacket1_S');
    assert.equal(motion.nativeChainLinks[0].target.record.bone, 'Jacket2_S');
});
