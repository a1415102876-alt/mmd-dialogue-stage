import test from 'node:test';
import assert from 'node:assert/strict';
import {Bone, Group, Scene, Object3D} from '../vendor/three/build/three.module.js';
import {RECOVERED_PHYSICS_ALGORITHM, SecondaryMotion, dynamicParticlePairAllowed} from '../gakumas-secondary-motion.js';

function fixture() {
    const scene = new Scene(), model = new Group(), unrelated = new Object3D();
    scene.add(model, unrelated);
    const springs = [], bones = [];
    for (const [name, mask] of [['Hair', 64], ['Jacket', 64], ['Skirt', 64], ['OtherHair', 8]]) {
        const bone = new Bone(), tip = new Bone();
        bone.name = name; tip.name = name + 'End'; tip.position.x = 1;
        model.add(bone); bone.add(tip); bones.push(bone, tip);
        springs.push({bone:name, colliderType:0, particleRadius:.1, collisionMask:mask, mass:1, damping:.5, spring:0, stiffness:0});
    }
    scene.updateMatrixWorld(true);
    const motion = new SecondaryMotion({springs, drivers:[], colliders:[], chains:[],nativeDynamicCollision:true});
    motion.bind(bones.map(bone=>({bone,position:bone.position.clone(),quaternion:bone.quaternion.clone()})));
    return {motion,scene,model,unrelated};
}

function recoveredBucketFixture() {
    const scene = new Scene(), model = new Group(), carrier = new Bone();
    scene.add(model);
    model.add(carrier);
    const springs = [], bones = [];
    for (const [name, parent] of [['Jacket', model], ['Hair', model], ['JacketDeep', carrier], ['HairDeep', carrier]]) {
        const bone = new Bone(), tip = new Bone();
        bone.name = name;
        tip.name = name + 'End';
        tip.position.x = 1;
        parent.add(bone);
        bone.add(tip);
        bones.push(bone, tip);
        springs.push({ bone: name, colliderType: 0, particleRadius: .1, collisionMask: 64, mass: 1, damping: .5, spring: 0, stiffness: 0 });
    }
    scene.updateMatrixWorld(true);
    const motion = new SecondaryMotion({
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        springs,
        drivers: [],
        colliders: [],
        chains: [],
        nativeDynamicCollision: true,
    });
    motion.bind(bones.map(bone => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() })));
    return motion;
}

test('dynamic candidate cache matches allowed pairs and refreshes on rebind', () => {
    const {motion} = fixture();
    const expected = [];
    motion.springs.forEach((a,i)=>motion.springs.slice(i+1).forEach(b=>{
        if(dynamicParticlePairAllowed(a.record,b.record)) expected.push([a,b]);
    }));
    assert.equal(expected.length,1);
    assert.deepEqual(motion.dynamicClothingPairs,expected);
    assert.equal(motion.dynamicClothingPairsByGroup.length,1);
    assert.deepEqual(motion.dynamicClothingPairsByGroup[0],expected);
    motion.bind([]);
    assert.deepEqual(motion.dynamicClothingPairs,[]);
    assert.deepEqual(motion.dynamicClothingPairsByGroup,[]);
});

test('recovered dynamic candidates are assigned to their deepest spring group', () => {
    const motion = recoveredBucketFixture();
    assert.equal(motion.dynamicClothingPairs.length, 4);
    assert.equal(motion.dynamicClothingPairsByGroup.length, 2);
    assert.equal(motion.dynamicClothingPairsByGroup[0].length, 1);
    assert.equal(motion.dynamicClothingPairsByGroup[1].length, 3);
    assert.equal(
        motion.dynamicClothingPairsByGroup.flat().length,
        motion.dynamicClothingPairs.length,
    );
});

test('physics pose writeback never traverses unrelated scene objects', () => {
    const {motion,unrelated} = fixture();
    let visits=0; const original=unrelated.updateMatrixWorld;
    unrelated.updateMatrixWorld=function(...args){visits++;return original.apply(this,args);};
    motion.update(); motion.restoreBeforeAnimation(); motion.update(.05);
    assert.equal(visits,0);
    assert.equal(motion.fixedStepCount,3);
});

test('completed clothing traces stop doing per-frame work', () => {
    const { motion } = fixture();
    motion.startClothingTrace({ test: true });
    for (let index = 0; index < 300; index += 1) motion.update(1 / 60);
    const complete = motion.getClothingTraceStatus();
    assert.equal(complete.complete, true);
    assert.equal(complete.ticks, 300);
    const frames = complete.frames;
    motion.update(1 / 60);
    const after = motion.getClothingTraceStatus();
    assert.equal(after.ticks, 300);
    assert.equal(after.frames, frames);
});
