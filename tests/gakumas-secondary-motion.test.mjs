import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bone } from '../vendor/three/build/three.module.js';
import {
    SecondaryMotion,
    QUARTZ_ROTATION,
    QUARTZ_HUMANOID_ARM,
    QUARTZ_HUMANOID_HAND,
    QUARTZ_HUMANOID_UPLEG,
    composeRestAndExtra,
    driverSide,
    eulerDegreesToQuaternionXYZ,
    hairDriverEuler,
    humanoidUpLegDriverQuaternion,
    humanoidQuartzDriverQuaternion,
    quartzRotationDriverQuaternion,
    integrateTail,
    masksOverlap,
    medianScale,
    quaternionToEulerDegreesXYZ,
    relativeEulerDegrees,
    resolveSphere,
    resolveCapsule,
    resolveCapsuleKeepSide,
    resolveCapsuleSegmentCollision,
    scaleAndClampEuler,
    selectQuartzDrivers,
    selectJacketFollowDrivers,
    jacketSkirtAnchor,
    skirtThighCollider,
    staticParticleRadius,
    springStaticParticleRadius,
    springStaticParticleRadiusForCollider,
    skipsContralateralLegCollider,
    skipsHairSpineCollider,
    skipsHairRootFaceCollider,
    skipsConfiguredHairRootCollider,
    skipsConfiguredHairStaticCollider,
    skipsConfiguredStaticCollisionPair,
    hasStaticSpringCollision,
    shouldPreserveHairRestTail,
    gravityScaleForSpring,
    skipsLargeSpineSkirtCollider,
    dynamicParticlePairAllowed,
    resolveDynamicParticlePair,
    colliderGeometryMoved,
    DEFAULT_SECONDARY_TUNING,
    chainLayerKind,
    chainLayerMinimumDistance,
    nativeChainCollisionRadius,

    separateRing,
    skirtCoefficient,
    skirtDriverQuaternion,
    skirtIsOuter,
    constrainLength,
    clampExtraByLimits,
    nativeHairLimitFrame,
    clampExtraByNativeHairFrame,
    remapLimitsToTail,
    authoredColliderShape,
    colliderWorldEnds,
    applyRecoveredStaticColliderPair,
    APPLY_SPRING_ANGLE_LIMITS,
    APPLY_SKIRT_QUARTZ_LIMITS,
    APPLY_SKIRT_INNER_OUTER,
    APPLY_JACKET_SKIRT_FOLLOW,
    continueAlongRest,
    carryParticleWithRest,
    carryParticleWithCarrier,
    relativeRootMotionDelta,
    preserveHairRestTail,
    effectiveSpringCollisionMask,
    nativeStaticColliderAllowed,
    recoveredSwingPairCollision,
    RECOVERED_PHYSICS_ALGORITHM,
    NATIVE_FIXED_STEP,
    nativeSwingForce,
    nativeIntegrateTail,
    nativeIntegrateSwingNode,
    nativeUnityEulerDegrees,
    nativeSwingRotation,
    nativeReferenceLimitQuaternion,
    unityEulerDegreesToQuaternion,
    hasNativeReferenceLimit,
    shouldUseNativeParticleHairLimit,
} from '../gakumas-secondary-motion.js';

const table = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../gakumas-secondary-motion.json'), 'utf8'));
const hskiTable = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../secondary-motion-profiles/hski.json'), 'utf8'));
const ttmrTable = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../secondary-motion-profiles/ttmr-casl.json'), 'utf8'));
const klljTable = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../secondary-motion-profiles/kllj-schl-0000.json'), 'utf8'));
const amaoTable = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../secondary-motion-profiles/amao-casl.json'), 'utf8'));
const kcnaTable = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../secondary-motion-profiles/kcna-casl.json'), 'utf8'));
const ssmkTable = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../secondary-motion-profiles/ssmk-schl-0000.json'), 'utf8'));

test('HumanoidUpLeg Quartz drivers are selected and apply their signed GLB twist', () => {
    const source = eulerDegreesToQuaternionXYZ([15, 0, 0]);
    const extra = humanoidUpLegDriverQuaternion(source, { dof: 2, coefficient: -1 });
    const euler = quaternionToEulerDegreesXYZ(extra);
    assert.ok(Math.abs(euler[0] + 15) < 1e-6, `expected -15° upper-leg twist, got ${euler[0]}`);
    assert.ok(Math.abs(euler[1]) < 1e-6);
    assert.ok(Math.abs(euler[2]) < 1e-6);

    const selected = selectQuartzDrivers({
        drivers: [{
            className: QUARTZ_HUMANOID_UPLEG,
            bone: 'LeftUpLeg_H',
            enabled: true,
            setting: { humanPartDof: 2, dof: 2, coefficient: -1 },
        }],
    });
    assert.equal(selected.length, 1);
});

test('captured Rotation, HumanoidArm, and HumanoidHand jobs are selected and keep degree coefficients', () => {
    const rotation = quartzRotationDriverQuaternion(
        eulerDegreesToQuaternionXYZ([0, 30, 0]),
        { coefficient: [0, -0.4, 0], limitMin: [-180, -180, -180], limitMax: [180, 180, 180] },
    );
    const rotationEuler = quaternionToEulerDegreesXYZ(rotation);
    assert.ok(Math.abs(rotationEuler[1] + 12) < 1e-6, `expected -12° rotation channel, got ${rotationEuler[1]}`);

    const generic = humanoidQuartzDriverQuaternion(
        eulerDegreesToQuaternionXYZ([20, 0, 0]),
        { humanPartDof: 4, coefficient: -0.8 },
    );
    const genericEuler = quaternionToEulerDegreesXYZ(generic);
    assert.ok(Math.abs(genericEuler[0] + 16) < 1e-6, `expected -16° arm channel, got ${genericEuler[0]}`);

    const selected = selectQuartzDrivers({ drivers: [
        { className: QUARTZ_ROTATION, enabled: true, bone: 'LeftForeArm_H' },
        { className: QUARTZ_HUMANOID_ARM, enabled: true, bone: 'LeftArm_H' },
        { className: QUARTZ_HUMANOID_HAND, enabled: true, bone: 'LeftHand_H' },
    ] });
    assert.deepEqual(selected.map(driver => driver.className), [QUARTZ_ROTATION, QUARTZ_HUMANOID_ARM, QUARTZ_HUMANOID_HAND]);
});

test('HumanoidArm binding writes a signed helper rotation from its source arm', () => {
    const identity = [0, 0, 0, 1];
    const arm = fakeBone('LeftArm', identity);
    const helper = fakeBone('LeftArm_H', identity);
    const motion = new SecondaryMotion({
        drivers: [{
            className: QUARTZ_HUMANOID_ARM,
            enabled: true,
            bone: 'LeftArm_H',
            setting: { humanPartDof: 4, coefficient: -0.8 },
        }],
    });
    motion.bind([
        { bone: arm, quaternion: { toArray: () => [...identity] } },
        { bone: helper, quaternion: { toArray: () => [...identity] } },
    ]);
    arm.quaternion.set(...eulerDegreesToQuaternionXYZ([20, 0, 0]));
    motion.update();
    const euler = quaternionToEulerDegreesXYZ(helper.quaternion.toArray());
    assert.ok(Math.abs(euler[0] + 16) < 1e-5, `arm helper should receive the signed roll, got ${euler[0]}`);
});

test('ttmr profile carries the four captured HumanoidUpLeg driver jobs', () => {
    assert.equal(ttmrTable.nativeSkirtCarrier, 'thigh');
    const drivers = selectQuartzDrivers(ttmrTable).filter(driver => driver.className === QUARTZ_HUMANOID_UPLEG);
    assert.deepEqual(drivers.map(driver => driver.bone).sort(), [
        'LeftUpLeg_H',
        'LeftUpLeg_Roll_H',
        'RightUpLeg_H',
        'RightUpLeg_Roll_H',
    ]);
    assert.deepEqual(drivers.map(driver => [driver.setting.humanPartDof, Number(driver.setting.coefficient.toFixed(3))]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), [
        [2, -1], [2, -0.6], [3, -1], [3, -0.6],
    ]);
});

test('kllj school profile uses complete outfit native geometry without long foot colliders', () => {
    assert.equal(klljTable.nativeDynamicGeometryApplied, 132);
    assert.equal(klljTable.nativeCaptureCoverage.joinedDynamicRecords, 132);
    assert.deepEqual(klljTable.nativeCaptureCoverage.rejectedNativeDynamicBones, []);
    assert.equal(klljTable.nativeChainGeometryApplied, 24);
    for (const bone of ['LeftFrontSkirt3_S', 'LeftFrontSkirt4_S_End', 'RightFrontSkirt3_S', 'RightFrontSkirt4_S_End']) {
        const chainRecord = klljTable.nativeChainGeometry.records.find(item => item.sourceBone === bone);
        assert.ok(chainRecord, `${bone} should have a named Unity chain source`);
        assert.equal(chainRecord.particleBinding, 'child');
    }
    assert.equal(klljTable.nativeSkirtRootFollow, undefined);
    assert.equal(klljTable.nativeSkirtThighCollisionRadiusScale, 1.15);
    assert.equal(klljTable.staticCollisionSkipPairs, undefined);
    for (const bone of ['CenterLeftRibbon1_S', 'CenterRightRibbon1_S', 'LeftFrontSkirt1_S', 'RightFrontSkirt1_S']) {
        assert.ok(Number.isInteger(klljTable.springs.find(item => item.bone === bone)?.nativeDynamicIndex), `${bone} should use its captured native particle`);
    }
    for (const bone of ['Spine2', 'LeftToeBase', 'RightToeBase']) {
        const collider = klljTable.colliders.find(item => item.bone === bone);
        assert.ok(collider, `${bone} collider should exist`);
        assert.ok(collider.unityLength < 0.1, `${bone} collider must remain a short native segment`);
    }
});

test('amao casl profile uses captured jacket dynamics and child chain links', () => {
    assert.equal(amaoTable.adaptationScope.nativeDynamic, 'all');
    assert.equal(amaoTable.nativeDynamicGeometryApplied, 172);
    assert.equal(amaoTable.nativeCaptureCoverage.joinedDynamicRecords, 172);
    assert.equal(amaoTable.nativeChainGeometryApplied, 37);
    assert.equal(amaoTable.nativeCaptureCoverage.joinedChainRecords, 37);
    const jacketSprings = amaoTable.springs.filter(record => /Jacket/.test(record.bone));
    assert.equal(jacketSprings.length, 40);
    assert.equal(jacketSprings.filter(record => Number.isInteger(record.nativeDynamicIndex)).length, 40);
    assert.equal(amaoTable.nativeChainGeometry.records.filter(record => /Jacket/.test(record.sourceBone || '')).length, 28);
});

test('kcna casl profile uses captured skirt dynamics, UpLeg drivers, and child chain links', () => {
    assert.equal(kcnaTable.adaptationScope.nativeDynamic, 'all');
    assert.equal(kcnaTable.nativeDynamicGeometryApplied, 165);
    assert.equal(kcnaTable.nativeCaptureCoverage.joinedDynamicRecords, 165);
    assert.equal(kcnaTable.nativeChainGeometryApplied, 86);
    assert.equal(kcnaTable.nativeCaptureCoverage.joinedChainRecords, 86);
    assert.equal(kcnaTable.drivers.filter(record => record.className === 'ActorAnimationQuartzDriverHumanoidUpLegBone').length, 4);
    assert.equal(kcnaTable.springs.filter(record => /Skirt/.test(record.bone) && Number.isInteger(record.nativeDynamicIndex)).length, 64);
    assert.equal(kcnaTable.nativeChainGeometry.records.filter(record => /Skirt/.test(record.sourceBone || '')).length, 56);
});

test('latest candidate profiles keep all three humanoid Quartz classes and native unit endpoints', () => {
    for (const profileName of [
        'hski', 'ttmr-casl', 'fktn-casl', 'atbm-schl-0000', 'amao-casl',
        'kllj-schl-0000', 'kcna-casl', 'ssmk-schl-0000', 'shro-casl',
        'jsna-schl-0000', 'hmsz-schl-0000', 'hume-schl-0000', 'hrnm-schl-0000',
    ]) {
        const profile = JSON.parse(readFileSync(resolve(
            dirname(fileURLToPath(import.meta.url)), `../secondary-motion-profiles/${profileName}.json`,
        ), 'utf8'));
        for (const className of [QUARTZ_ROTATION, QUARTZ_HUMANOID_ARM, QUARTZ_HUMANOID_HAND]) {
            assert.equal(profile.drivers.filter(driver => driver.className === className).length, 4, `${profileName} should keep four ${className} jobs`);
        }
        assert.equal(profile.quartzStageAdaptation.status, 'stage-adaptation-native-io-unverified');
    }
    for (const bone of ['LeftToeBase', 'RightToeBase']) {
        const collider = ssmkTable.colliders.find(item => item.bone === bone);
        assert.ok(collider?.nativeGeometry, `${bone} should use captured native geometry`);
        assert.ok(Math.abs(collider.unityLength - 0.045) < 1e-5, `${bone} should stay a 4.5cm capsule`);
    }
});

test('kllj front skirt 3 and 4 chain links use Unity child particles', () => {
    const root = new Bone();
    root.name = 'Pelvis';
    const bones = [root];
    const springRecords = [];
    for (const side of ['Left', 'Right']) {
        let parent = root;
        for (const index of [1, 2, 3]) {
            const bone = new Bone();
            bone.name = `${side}FrontSkirt${index}_S`;
            bone.position.set(0, -1, side === 'Left' ? 0.1 : -0.1);
            parent.add(bone);
            bones.push(bone);
            if (index >= 2) {
                const record = klljTable.springs.find(item => item.bone === bone.name);
                assert.ok(record, `${bone.name} should be in the Lilia profile`);
                springRecords.push(record);
            }
            parent = bone;
        }
        const end = new Bone();
        end.name = `${side}FrontSkirt4_S_End`;
        end.position.set(0, -1, side === 'Left' ? 0.1 : -0.1);
        parent.add(end);
        bones.push(end);
        const endRecord = klljTable.springs.find(item => item.bone === end.name);
        assert.ok(endRecord, `${end.name} should be in the Lilia profile`);
        springRecords.push(endRecord);
    }
    root.updateMatrixWorld(true);
    const motion = new SecondaryMotion({
        ...klljTable,
        springs: springRecords,
    });
    motion.bind(bones.map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
    })));
    const front3 = motion.nativeChainLinks.find(link => link.sourceBone === 'LeftFrontSkirt3_S');
    const front4 = motion.nativeChainLinks.find(link => link.sourceBone === 'LeftFrontSkirt4_S_End');
    assert.equal(front3?.source.record.bone, 'LeftFrontSkirt2_S');
    assert.equal(front3?.target.record.bone, 'RightFrontSkirt2_S');
    assert.equal(front4?.source.record.bone, 'LeftFrontSkirt3_S');
    assert.equal(front4?.target.record.bone, 'RightFrontSkirt3_S');
});

test('runtime table has quartz drivers, springs, colliders and rings', () => {
    assert.ok(table.version >= 2);
    assert.equal(selectQuartzDrivers(table).length, 10);
    assert.equal(table.springs.length, 187);
    assert.equal(table.colliders.length, 21);
    assert.equal(table.chains.length, 2);
    assert.equal(table.chains[0].layers[0].bones.length, 8);
    assert.ok(table.springs.every(item => item.bone && 'damping' in item && 'particleRadius' in item));
    assert.ok(table.colliders.every(item => item.bone && Array.isArray(item.offsetA)));
    assert.equal(table.version, 3);
    assert.equal(table.nativeDynamicCollision, true);
    assert.ok(table.nativeDynamicGeometryApplied >= 140);
    assert.equal(table.nativeChainGeometryApplied, 44);
    assert.equal(table.nativeChainGeometry.records.length, 44);
    assert.deepEqual(table.nativeChainGeometry.records.slice(0, 2).map(item => [item.dynamicBoneIndex, item.chainOffsetIndex, item.around]), [[28, -3, true], [25, 1, true]]);
    assert.ok(table.colliders.every(item => item.space === 'pmxLocal' && item.kind));
    const braidTail = table.springs.find(item => item.bone === 'LeftSideHair8_S_End');
    assert.equal(braidTail.collisionMask, 8);
    assert.ok(Math.abs(braidTail.particleRadius - 0.02) < 1e-6);
    const braidRoot = table.springs.find(item => item.bone === 'LeftSideHair1_S');
    assert.equal(braidRoot.collisionMask, -1);
    assert.ok(Math.abs(braidRoot.particleRadius - 0.05) < 1e-6);
    const thigh = table.colliders.find(item => item.bone === 'LeftLeg' && item.type === 2 && item.collisionMask === 64);
    const right = table.colliders.find(item => item.bone === 'RightLeg' && item.type === 2 && item.collisionMask === 64);
    assert.ok(thigh.offsetB[1] > 3.5, 'thigh capsule should span knee to hip');
    assert.equal(thigh.aimBone, 'LeftUpLeg');
    assert.equal(right.aimBone, 'RightUpLeg');
    assert.ok(Math.abs(thigh.offsetB[0]) < 0.15);
    assert.ok(Math.abs(thigh.offsetB[2]) < 0.15);
    const headFace = table.colliders.find(item => item.bone === 'Head_Face');
    assert.ok(headFace, 'the native Head_Face collider must protect all hair particles');
    assert.equal(headFace.collisionMask, 65336);
    assert.equal(headFace.kind, 'capsule');
    assert.ok(Math.abs(headFace.radiusA - 0.07) < 1e-6, 'Head_Face keeps the native Unity radius until runtime scale is applied');
});

test('HSKI runner disables the generic Stage prewarm to match Unity', () => {
    assert.equal(hskiTable.nativePrewarmSteps, 0);
});

test('HSKI scopes Unity parent-local limits to the side-hair corrections', () => {
    assert.deepEqual(hskiTable.nativeUnityLocalLimitBones, [
        'LeftHairSide2_S',
        'RightHairSide2_S',
        'RightBackSideLHair1_S',
        'RightBackSideLHair2_S',
        'RightBackSideLHair3_S',
        'RightBackSideLHair4_S',
        'RightBackSideLHair5_S_End',
    ]);
    assert.deepEqual(hskiTable.nativeUnityLocalLimitGlbBones, [
        'RightBackSideLHair1_S',
        'RightBackSideLHair2_S',
        'RightBackSideLHair3_S',
        'RightBackSideLHair4_S',
        'RightBackSideLHair5_S_End',
    ]);
});

test('native Unity Euler conversion follows ActorAnimationSwingSolver', () => {
    const q = [0.11, -0.22, 0.33, 0.91];
    const length = Math.hypot(...q);
    const normalized = q.map(value => value / length);
    const [x, y, z, w] = normalized;
    const expected = [
        Math.asin(Math.max(-1, Math.min(1, 2 * (w * x - y * z)))) * 180 / Math.PI,
        Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y)) * 180 / Math.PI,
        Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z)) * 180 / Math.PI,
    ];
    const actual = nativeUnityEulerDegrees(normalized);
    actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9));
});

test('Unity reference limits use Quaternion.Euler ZXY order and boolean axes', () => {
    const unityToGlb = q => [q[0], -q[1], -q[2], q[3]];
    const target = unityToGlb(unityEulerDegreesToQuaternion([10, 20, 60]));
    const reference = unityToGlb(unityEulerDegreesToQuaternion([5, 15, 30]));
    const limited = nativeReferenceLimitQuaternion(target, reference, [1, 0, 0], [0, 1, 1], true);
    const euler = nativeUnityEulerDegrees(unityToGlb(limited));
    assert.ok(Math.abs(euler[0] - 10) < 1e-5, `min X must keep 10° above 5°, got ${euler[0]}`);
    assert.ok(Math.abs(euler[1] - 15) < 1e-5, `max Y must clamp to 15°, got ${euler[1]}`);
    assert.ok(Math.abs(euler[2] - 30) < 1e-5, `max Z must clamp to 30°, got ${euler[2]}`);
});

test('reference limit binding requires a named reference and an enabled flag', () => {
    assert.equal(hasNativeReferenceLimit({ bone: null, min: [1, 0, 0], max: [0, 0, 0] }), false);
    assert.equal(hasNativeReferenceLimit({ bone: { name: 'Skirt1' }, min: [0, 0, 0], max: [0, 0, 0] }), false);
    assert.equal(hasNativeReferenceLimit({ bone: { name: 'Skirt1' }, min: [1, 0, 0], max: [0, 0, 1] }), true);
});

test('native Unity hair limits clamp in the parent-local frame', () => {
    const solved = nativeSwingRotation(
        [0, 0, 0, 1],
        [0, 0, 0, 1],
        [0, 0, 0, 1],
        [0, 1, 0],
        [0, 0, 1],
        { useLimit: 1, axisX: [-20, 20], axisY: [-180, 180], axisZ: [-180, 180] },
    );
    assert.ok(Math.abs(nativeUnityEulerDegrees(solved)[0] - 20) < 1e-5);
});

test('GLB hair limits convert Unity local Y/Z signs before writeback', () => {
    const target = eulerDegreesToQuaternionXYZ([0, 0, 25]);
    const direction = [
        1 - 2 * (target[1] * target[1] + target[2] * target[2]),
        2 * (target[0] * target[1] + target[2] * target[3]),
        0,
    ];
    const solved = nativeSwingRotation(
        [0, 0, 0, 1],
        [0, 0, 0, 1],
        [0, 0, 0, 1],
        [1, 0, 0],
        direction,
        { useLimit: 1, axisX: [0, 0], axisY: [0, 0], axisZ: [25, 25] },
        1,
        true,
    );
    assert.ok(solved[2] < -0.2, `expected GLB Z rotation to be negative: ${solved}`);
});

test('HSKI Head_Face uses Unity native vertical capsule endpoints', () => {
    const headFace = hskiTable.colliders.find(item => item.bone === 'Head_Face');
    assert.ok(headFace);
    assert.equal(headFace.carrierBone, 'Head_Face');
    assert.ok(Math.abs(headFace.unityOffsetA[0]) < 1e-6);
    assert.ok(Math.abs(headFace.unityOffsetB[0]) < 1e-6);
    assert.ok(Math.abs(headFace.unityOffsetA[1] - 0.06) < 1e-6);
    assert.ok(Math.abs(headFace.unityOffsetB[1] - 0.01) < 1e-6);
    assert.ok(Math.abs(headFace.unityOffsetA[2] - headFace.unityOffsetB[2]) < 1e-6);
});

test('GLB Head_Face keeps Unity-local endpoints under the GLB root scale', () => {
    const headFace = hskiTable.colliders.find(item => item.bone === 'Head_Face');
    const shape = authoredColliderShape({ ...headFace, runtimeWorldScale: 12.5 }, 12.5);
    assert.deepEqual(shape.localA, headFace.unityOffsetA);
    assert.deepEqual(shape.localB, headFace.unityOffsetB);
    assert.ok(Math.abs(shape.radiusA - 0.875) < 1e-6);
    assert.ok(Math.abs(shape.radiusB - 0.625) < 1e-6);
});

test('jacket springs use the captured modeling rest chain when it differs from PMX spacing', () => {
    const root = new Bone();
    root.name = 'Spine';
    const first = new Bone();
    first.name = 'LeftBackJacket1_S';
    first.position.set(0, 1, 0);
    const second = new Bone();
    second.name = 'LeftBackJacket2_S';
    second.position.set(0, 1, 0);
    root.add(first);
    first.add(second);
    root.updateMatrixWorld(true);

    const restPose = [root, first, second].map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const motion = new SecondaryMotion({
        useModelingRestPose: true,
        springs: [
            {
                bone: first.name,
                part: 'body',
                damping: 0,
                stiffness: 0,
                spring: 0,
                mass: 1,
                collisionMask: 0,
                colliderType: 4,
                unityLocalPosition: [0, 0.08, 0],
                modelingLocalTx: { translation: [0, 0.08, 0], rotation: [0, 0, 0, 1] },
                modelingWorldPosition: [0, 0.10, 0],
            },
            {
                bone: second.name,
                part: 'body',
                damping: 0,
                stiffness: 0,
                spring: 0,
                mass: 1,
                collisionMask: 0,
                colliderType: 4,
                unityLocalPosition: [0, 0.08, 0],
                modelingLocalTx: { translation: [0, 0.08, 0], rotation: [0, 0, 0, 1] },
                modelingWorldPosition: [0, 0.25, 0],
            },
        ],
        colliders: [],
        drivers: [],
        chains: [],
    });

    motion.bind(restPose);

    const spring = motion.springs.find(item => item.record.bone === first.name);
    assert.ok(spring);
    assert.ok(Math.abs(spring.restLength - 1.875) < 1e-6, `expected modeling rest length, got ${spring.restLength}`);
    assert.deepEqual(spring.tailLocal.map(value => Number(value.toFixed(6))), [0, 1.875, 0]);
});

test('GLB jacket springs keep the exported child local frame', () => {
    const root = new Bone();
    root.name = 'Spine';
    const first = new Bone();
    first.name = 'LeftBackJacket1_S';
    first.position.set(0, 1, 0);
    first.rotation.z = Math.PI / 2;
    const second = new Bone();
    second.name = 'LeftBackJacket2_S';
    second.position.set(0, 1, 0);
    root.add(first);
    first.add(second);
    root.updateMatrixWorld(true);

    const restPose = [root, first, second].map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const motion = new SecondaryMotion({
        skirtDriverBasis: 'gltf-unity',
        useModelingRestPose: true,
        springs: [
            {
                bone: first.name,
                part: 'body',
                damping: 0,
                stiffness: 0,
                spring: 0,
                mass: 1,
                collisionMask: 0,
                colliderType: 4,
                unityLocalPosition: [0, 0.08, 0],
                modelingLocalTx: { translation: [0, 0.08, 0], rotation: [0, 0, 0, 1] },
                // This is the Unity-space world delta used by the PMX path.
                // It must not replace the GLB child local vector.
                modelingWorldPosition: [0, 0.10, 0],
            },
            {
                bone: second.name,
                part: 'body',
                damping: 0,
                stiffness: 0,
                spring: 0,
                mass: 1,
                collisionMask: 0,
                colliderType: 4,
                unityLocalPosition: [0, 0.08, 0],
                modelingLocalTx: { translation: [0, 0.08, 0], rotation: [0, 0, 0, 1] },
                modelingWorldPosition: [0, 0.25, 0],
            },
        ],
        colliders: [],
        drivers: [],
        chains: [],
    });

    motion.bind(restPose);

    const spring = motion.springs.find(item => item.record.bone === first.name);
    assert.ok(spring);
    assert.deepEqual(spring.tailLocal.map(value => Number(value.toFixed(6))), [0, 1, 0]);
    assert.ok(Math.abs(spring.restLength - 1) < 1e-6);
});

test('scale-and-clamp uses the authored limits', () => {
    assert.deepEqual(scaleAndClampEuler([20, 10, -10], [0.5, 2, 1], [-5, -5, -5], [5, 5, 5]), [5, 5, -5]);
    assert.deepEqual(scaleAndClampEuler([0, 0, 0], [1, 1, 1], [-1, -1, -1], [1, 1, 1]), [0, 0, 0]);
});

test('hair follows both head and neck after each channel is limited', () => {
    const setting = {
        headRotateCoefficient: [-0.5, -0.7, -0.6],
        headRotateLimitMin: [-10, -10, -10],
        headRotateLimitMax: [10, 10, 10],
        neckRotateCoefficient: [-0.4, -0.7, -0.6],
        neckRotateLimitMin: [-4, -4, -4],
        neckRotateLimitMax: [4, 4, 4],
    };
    assert.deepEqual(hairDriverEuler([20, 0, 0], [20, 0, 0], setting).map(value => Object.is(value, -0) ? 0 : value), [-14, 0, 0]);
});

test('skirt follow copies the thigh quaternion instead of scaling XYZ euler', () => {
    const setting = { connectionAxis: 0, innerCoefficient: [0, 0.1, 0.1], outerCoefficient: [1, 1, 1], limitMin: [-180, -180, -180], limitMax: [180, 180, 180] };
    assert.equal(driverSide('LeftBackSkirt_A'), 'left');
    assert.equal(driverSide('RightFrontSkirt_A'), 'right');
    const walk = eulerDegreesToQuaternionXYZ([-20, 0, 0]);
    assert.deepEqual(skirtCoefficient(walk, setting, 'left'), [1, 1, 1]);
    assert.deepEqual(skirtCoefficient(walk, setting, 'right'), [1, 1, 1]);
    const followed = skirtDriverQuaternion(walk, setting, 'left');
    for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(followed[i] - walk[i]) < 1e-6);
    const followedRight = skirtDriverQuaternion(walk, setting, 'right');
    for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(followedRight[i] - walk[i]) < 1e-6);
    const leftIn = eulerDegreesToQuaternionXYZ([0, 0, -20]);
    const rightIn = eulerDegreesToQuaternionXYZ([0, 0, 20]);
    assert.equal(APPLY_SKIRT_INNER_OUTER, false);
    assert.equal(skirtIsOuter(leftIn, setting, 'left'), true);
    assert.equal(skirtIsOuter(rightIn, setting, 'right'), true);
    assert.deepEqual(skirtCoefficient(leftIn, setting, 'left'), [1, 1, 1]);
    assert.equal(skirtIsOuter(eulerDegreesToQuaternionXYZ([0, 0, 20]), setting, 'left'), true);
    assert.equal(skirtIsOuter(eulerDegreesToQuaternionXYZ([0, 0, -20]), setting, 'right'), true);
});

test('left and right walk both copy the thigh, and adduction is also treated as outer', () => {
    const setting = {
        connectionAxis: 0,
        innerCoefficient: [0, 0.1, 0.1],
        outerCoefficient: [1, 1, 1],
        limitMin: [-180, -180, -180],
        limitMax: [180, 40, 5],
    };
    const walk = eulerDegreesToQuaternionXYZ([-60, 0, 0]);
    const leftWalk = skirtDriverQuaternion(walk, setting, 'left');
    const rightWalk = skirtDriverQuaternion(walk, setting, 'right');
    for (let i = 0; i < 4; i += 1) {
        assert.ok(Math.abs(leftWalk[i] - walk[i]) < 1e-6, 'left flexion stays outer');
        assert.ok(Math.abs(rightWalk[i] - walk[i]) < 1e-6, 'right flexion stays outer');
    }
    const sitting = quaternionToEulerDegreesXYZ(skirtDriverQuaternion(eulerDegreesToQuaternionXYZ([-80, 0, 25]), setting, 'left'));
    assert.ok(Math.abs(sitting[0] + 80) < 2, 'extreme sit swing is not collapsed by euler conversion');
    const adducted = eulerDegreesToQuaternionXYZ([-20, 0, -25]);
    const followed = skirtDriverQuaternion(adducted, setting, 'left');
    for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(followed[i] - adducted[i]) < 1e-6, 'adduction still copies the full extra');
    assert.ok(APPLY_SKIRT_QUARTZ_LIMITS === false);
    assert.ok(APPLY_SPRING_ANGLE_LIMITS === true);
    assert.ok(APPLY_SKIRT_INNER_OUTER === false);
});

test('xyz euler conversion round-trips a single-axis turn', () => {
    const quaternion = eulerDegreesToQuaternionXYZ([0, 30, 0]);
    const euler = quaternionToEulerDegreesXYZ(quaternion);
    assert.ok(Math.abs(euler[1] - 30) < 1e-6);
    assert.ok(Math.abs(euler[0]) < 1e-6);
    assert.ok(Math.abs(euler[2]) < 1e-6);
    assert.deepEqual(relativeEulerDegrees([0, 0, 0, 1], [0, 0, 0, 1]), [0, 0, 0]);
});

test('compose starts from rest so a leftover pose cannot leak into the next clip', () => {
    const rest = [0, 0, 0, 1];
    const composed = composeRestAndExtra(rest, [0, 20, 0]);
    const euler = quaternionToEulerDegreesXYZ(composed);
    assert.ok(Math.abs(euler[1] - 20) < 1e-6);
});

function fakeBone(name, quaternion) {
    const value = [...quaternion];
    return {
        name,
        quaternion: {
            toArray: () => [...value],
            set(x, y, z, w) { value.splice(0, 4, x, y, z, w); },
        },
    };
}


test('bind skips missing bones and update writes the hair anchors', () => {
    const head = fakeBone('Head', [0, 0, 0, 1]);
    const neck = fakeBone('Neck', [0, 0, 0, 1]);
    const hair = fakeBone('LeftSideHair_A', [0, 0, 0, 1]);
    const rest = [
        { bone: head, quaternion: { toArray: () => [0, 0, 0, 1] } },
        { bone: neck, quaternion: { toArray: () => [0, 0, 0, 1] } },
        { bone: hair, quaternion: { toArray: () => [0, 0, 0, 1] } },
    ];
    const motion = new SecondaryMotion({
        drivers: [
            table.drivers.find(driver => driver.bone === 'LeftSideHair_A'),
            { className: 'ActorAnimationQuartzDriverSkirtBone', enabled: true, bone: 'MissingSkirt', setting: { referenceBone: { name: 'LeftUpLeg' } } },
        ],
    });
    motion.bind(rest);
    assert.deepEqual(motion.missing, ['MissingSkirt']);
    head.quaternion.set(...eulerDegreesToQuaternionXYZ([20, 0, 0]));
    motion.update();
    assert.ok(hair.quaternion.toArray().some((value, index) => Math.abs(value - [0, 0, 0, 1][index]) > 1e-8));
    motion.enabled = false;
    motion.update();
    assert.deepEqual(hair.quaternion.toArray(), [0, 0, 0, 1]);
});

test('skirt binding copies the live UpLeg quaternion onto the panel', () => {
    const identity = [0, 0, 0, 1];
    const upLeg = fakeBone('LeftUpLeg', identity);
    const skirt = fakeBone('LeftFrontSkirt_A', identity);
    const motion = new SecondaryMotion({
        drivers: [table.drivers.find(driver => driver.bone === 'LeftFrontSkirt_A')],
    });
    motion.bind([
        { bone: upLeg, quaternion: { toArray: () => [...identity] } },
        { bone: skirt, quaternion: { toArray: () => [...identity] } },
    ]);
    const lifted = eulerDegreesToQuaternionXYZ([-80, 0, 0]);
    upLeg.quaternion.set(...lifted);
    motion.update();
    const got = skirt.quaternion.toArray();
    for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(got[i] - lifted[i]) < 1e-5, `skirt[${i}] should follow the thigh`);
});

test('profile-specific skirt root follow works when explicitly configured', () => {
    const identity = [0, 0, 0, 1];
    const upLeg = fakeBone('LeftUpLeg', identity);
    const root = fakeBone('Skirt_Leftside_O', identity);
    const motion = new SecondaryMotion({
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        nativeSkirtRootFollow: { Skirt_Leftside_O: 'LeftUpLeg' },
        drivers: [], springs: [], colliders: [], chains: [],
    });
    motion.bind([
        { bone: upLeg, quaternion: { toArray: () => [...identity] } },
        { bone: root, quaternion: { toArray: () => [...identity] } },
    ]);
    const lifted = eulerDegreesToQuaternionXYZ([-80, 0, 0]);
    upLeg.quaternion.set(...lifted);
    motion.update();
    const got = root.quaternion.toArray();
    for (let i = 0; i < 4; i += 1) assert.ok(Math.abs(got[i] - lifted[i]) < 1e-5, `skirt root[${i}] should follow the sibling thigh`);
});

test('HumanoidUpLeg binding writes the captured roll helper from the live thigh', () => {
    const identity = [0, 0, 0, 1];
    const upLeg = fakeBone('LeftUpLeg', identity);
    const helper = fakeBone('LeftUpLeg_H', identity);
    const motion = new SecondaryMotion({
        drivers: [{
            className: QUARTZ_HUMANOID_UPLEG,
            enabled: true,
            bone: 'LeftUpLeg_H',
            setting: { humanPartDof: 2, dof: 2, coefficient: -1 },
        }],
    });
    motion.bind([
        { bone: upLeg, quaternion: { toArray: () => [...identity] } },
        { bone: helper, quaternion: { toArray: () => [...identity] } },
    ]);
    upLeg.quaternion.set(...eulerDegreesToQuaternionXYZ([20, 0, 0]));
    motion.update();
    const euler = quaternionToEulerDegreesXYZ(helper.quaternion.toArray());
    assert.ok(Math.abs(euler[0] + 20) < 1e-5, `helper should receive the signed roll, got ${euler[0]}`);
});

test('native force keeps mass on the 0.01 caller scale', () => {
    const withMass = nativeSwingForce([0, 1, 0], [0, 1, 0], [0, 1, 0], { damping: 0, stiffness: 0, spring: 0, pendulum: 0.8, pendulumRange: 1, mass: 1 }, 1);
    const withoutMass = nativeSwingForce([0, 1, 0], [0, 1, 0], [0, 1, 0], { damping: 0, stiffness: 0, spring: 0, pendulum: 0.8, pendulumRange: 1, mass: 0 }, 1);
    assert.ok(withMass[1] < withoutMass[1]);
    assert.ok(Math.abs(withMass[1] - withoutMass[1] + 0.01) < 1e-6);
});

test('native damping uses the squared child-default correction', () => {
    const force = nativeSwingForce([0, 0, 0], [0, 1, 0], [0, 1, 0], { damping: 0.5, stiffness: 0, spring: 0, pendulum: 0, mass: 0 }, 1);
    assert.ok(Math.abs(force[1] - 0.25) < 1e-6);
});

test('native integration clamps the render supplied duration to one fixed step', () => {
    const params = { damping: 0.5, stiffness: 0.02, spring: 0, pendulum: 0, mass: 0 };
    const fixed = nativeIntegrateTail([0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 0], params, NATIVE_FIXED_STEP, 1);
    const renderDelta = nativeIntegrateTail([0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 0], params, 1 / 30, 1);
    assert.equal(fixed.step, renderDelta.step);
    assert.deepEqual(fixed.next, renderDelta.next);
});

test('native node integration derives swing rotation and keeps its authored length', () => {
    const result = nativeIntegrateSwingNode({
        position: [1, 0, 0], speed: [0, 0, 0], selfRotation: [0, 0, 0, 1],
    }, { damping: 0, stiffness: 0, spring: 0, pendulum: 0, mass: 1 }, {
        anchor: [0, 0, 0], childLocal: [1, 0, 0], axis: [1, 0, 0], length: 1,
    });
    assert.ok(result.position[1] < -0.006, 'mass should pull the tip down during the fixed step');
    assert.ok(Math.abs(Math.hypot(...result.position) - 1) < 1e-6);
    assert.ok(result.selfRotation[2] < -0.003, 'the node rotation must follow the free particle');
});

test('native prewarm integrates half the configured steps inside one node step', () => {
    const state = { position: [1, 0, 0], speed: [0, 0, 0], selfRotation: [0, 0, 0, 1] };
    const params = { damping: 0.5, stiffness: 0, spring: 0, pendulum: 0, mass: 1 };
    const options = { anchor: [0, 0, 0], childLocal: [1, 0, 0], axis: [1, 0, 0], length: 1 };
    const ordinary = nativeIntegrateSwingNode(state, params, options);
    const prewarmed = nativeIntegrateSwingNode(state, params, { ...options, prewarm: true, prewarmSteps: 10 });
    assert.ok(Math.abs(prewarmed.position[1]) > Math.abs(ordinary.position[1]) * 1.1);
    assert.ok(Math.abs(Math.hypot(...prewarmed.position) - 1) < 1e-6);
});

test('profile injection after construction still enables the native prewarm budget', () => {
    const root = new Bone();
    root.name = 'ActorRoot';
    const hair = new Bone();
    hair.name = 'LeftHair1_S';
    const tip = new Bone();
    tip.name = 'LeftHair2_S';
    tip.position.set(0, 1, 0);
    root.add(hair);
    hair.add(tip);
    root.updateMatrixWorld(true);
    const restPose = [root, hair, tip].map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const motion = new SecondaryMotion();
    motion.table = {
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        springs: [{
            bone: hair.name,
            part: 'hair',
            mass: 1,
            spring: 0,
            damping: 0,
            stiffness: 0,
            pendulum: 0,
            pendulumRange: 1,
            collisionMask: 0,
            colliderType: 4,
        }],
        colliders: [],
        drivers: [],
        chains: [],
    };
    motion.bind(restPose);
    assert.equal(motion.nativePrewarmSteps, 30);
});

test('native root cancel uses the actor root instead of the Hips bind height', () => {
    const root = new Bone();
    root.name = 'ActorRoot';
    const hips = new Bone();
    hips.name = 'Hips';
    hips.position.set(0, 2, 0);
    const hair = new Bone();
    hair.name = 'LeftHair1_S';
    const tip = new Bone();
    tip.name = 'LeftHair2_S';
    tip.position.set(0, 1, 0);
    root.add(hips);
    hips.add(hair);
    hair.add(tip);
    root.updateMatrixWorld(true);
    const restPose = [root, hips, hair, tip].map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const motion = new SecondaryMotion({
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        nativePrewarmSteps: 0,
        springs: [{
            bone: hair.name,
            part: 'hair',
            rootWeight: 0.3,
            mass: 0,
            spring: 0,
            damping: 0,
            stiffness: 0,
            pendulum: 0,
            pendulumRange: 1,
            collisionMask: 0,
            colliderType: 4,
        }],
        colliders: [],
        drivers: [],
        chains: [],
    });
    motion.bind(restPose);
    motion.update(1 / 60);
    assert.deepEqual(motion.springs[0].rootCancel, [0, 0, 0]);
});

test('slide axis coupling runs in the node rotation frame', () => {
    const half = Math.sqrt(0.5);
    const force = nativeSwingForce([1, 1, 0], [1, 1, 0], [1, 1, 0], {
        dynamicType: 1, damping: 0, stiffness: 0, spring: 1, mass: 0,
        axisAddXToY: 1, nativeSelfRotation: [0, 0, half, half],
    }, 1, false, [1, 2, 0]);
    assert.ok(Math.abs(force[0] - 3) < 1e-6);
    assert.ok(Math.abs(force[1] - 2) < 1e-6);
});

test('native hair gravity survives the provisional collision frame and rotates the bone', () => {
    const root = new Bone();
    root.name = 'Root';
    const hair = new Bone();
    hair.name = 'LeftHair1_S';
    const child = new Bone();
    child.name = 'LeftHair2_S';
    child.position.set(1, 0, 0);
    root.add(hair);
    hair.add(child);
    root.updateMatrixWorld(true);
    const identity = [0, 0, 0, 1];
    const restPose = [root, hair, child].map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const motion = new SecondaryMotion({
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        stableHairContacts: true,
        springs: [{
            bone: hair.name,
            part: 'hair',
            mass: 1,
            spring: 0,
            damping: 0,
            stiffness: 0,
            pendulum: 0,
            pendulumRange: 1,
            gravityScale: 1,
            collisionMask: 0,
            colliderType: 4,
            limitInfo: { useLimit: 1, axisX: [0, 0], axisY: [-90, 90], axisZ: [-90, 90] },
        }],
        colliders: [],
        drivers: [],
        chains: [],
    });
    motion.bind(restPose);
    motion.update(1 / 60);
    const quaternion = hair.quaternion.toArray();
    assert.deepEqual(identity.slice(0, 2), quaternion.slice(0, 2));
    assert.ok(Math.abs(quaternion[2]) > 1e-4, `gravity should rotate the hair bone, got ${quaternion}`);
});

test('native spring uses the child node settings for the current particle', () => {
    const root = new Bone();
    root.name = 'Root';
    const first = new Bone();
    first.name = 'LeftSideBackHair1_S';
    const second = new Bone();
    second.name = 'LeftSideBackHair2_S';
    const third = new Bone();
    third.name = 'LeftSideBackHair3_S';
    second.position.set(1, 0, 0);
    third.position.set(1, 0, 0);
    root.add(first);
    first.add(second);
    second.add(third);
    root.updateMatrixWorld(true);
    const restPose = [root, first, second, third].map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const motion = new SecondaryMotion({
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        nativePrewarmSteps: 0,
        springs: [
            {
                bone: first.name,
                part: 'hair',
                mass: 0,
                spring: 0,
                damping: 0,
                stiffness: 0,
                pendulum: 0,
                collisionMask: 0,
                colliderType: 4,
                limitInfo: { useLimit: 0 },
            },
            {
                bone: second.name,
                part: 'hair',
                mass: 1,
                spring: 0,
                damping: 0,
                stiffness: 0,
                pendulum: 0,
                collisionMask: 0,
                colliderType: 4,
                limitInfo: { useLimit: 0 },
            },
        ],
        colliders: [],
        drivers: [],
        chains: [],
    });
    motion.bind(restPose);
    const firstState = motion.springs.find(item => item.record.bone === first.name);
    assert.ok(firstState);
    motion.update(1 / 60);
    assert.ok(Math.abs(firstState.selfRotation[2]) > 1e-5,
        `the first particle should inherit gravity from its child setting, got ${firstState.selfRotation}`);
});

test('native spring keeps the current bone angular limits while using child dynamics', () => {
    const root = new Bone();
    root.name = 'Root';
    const first = new Bone();
    first.name = 'LeftSideBackHair1_S';
    const second = new Bone();
    second.name = 'LeftSideBackHair2_S';
    second.position.set(1, 0, 0);
    root.add(first);
    first.add(second);
    root.updateMatrixWorld(true);
    const restPose = [root, first, second].map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const rootLimits = { useLimit: 1, axisX: [0, 0], axisY: [-10, 10], axisZ: [-25, 25] };
    const childLimits = { useLimit: 1, axisX: [0, 0], axisY: [-20, 20], axisZ: [-60, 60] };
    const motion = new SecondaryMotion({
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        nativeParticleHairLimits: true,
        nativePrewarmSteps: 0,
        springs: [
            { bone: first.name, part: 'hair', nativeDynamicIndex: 1, nativeParentIndex: -1, nativeBoneAxis: [1, 0, 0], modelingLocalTx: { rotation: [0, 0, 0, 1] }, limitInfo: rootLimits },
            { bone: second.name, part: 'hair', nativeDynamicIndex: 2, nativeParentIndex: 1, nativeBoneAxis: [1, 0, 0], modelingLocalTx: { rotation: [0, 0, 0, 1] }, limitInfo: childLimits },
        ],
        colliders: [], drivers: [], chains: [],
    });
    motion.bind(restPose);
    const firstState = motion.springs.find(item => item.record.bone === first.name);
    assert.deepEqual(firstState.nativeParticleLimit.limitInfo, rootLimits);
});

test('native root weight does not pin the first hair particle to its rest tail', () => {
    const root = new Bone();
    root.name = 'Root';
    const first = new Bone();
    first.name = 'LeftSideBackHair1_S';
    const second = new Bone();
    second.name = 'LeftSideBackHair2_S';
    second.position.set(1, 0, 0);
    root.add(first);
    first.add(second);
    root.updateMatrixWorld(true);
    const restPose = [root, first, second].map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const motion = new SecondaryMotion({
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        nativePrewarmSteps: 0,
        stableHairContacts: true,
        springs: [
            {
                bone: first.name,
                part: 'hair',
                rootWeight: 1,
                mass: 0,
                spring: 0,
                damping: 0,
                stiffness: 0,
                pendulum: 0,
                collisionMask: 0,
                colliderType: 4,
                limitInfo: { useLimit: 0 },
            },
            {
                bone: second.name,
                part: 'hair',
                mass: 1,
                spring: 0,
                damping: 0,
                stiffness: 0,
                pendulum: 0,
                collisionMask: 0,
                colliderType: 4,
                limitInfo: { useLimit: 0 },
            },
        ],
        colliders: [],
        drivers: [],
        chains: [],
    });
    motion.bind(restPose);
    motion.update(1 / 60);
    const firstState = motion.springs.find(item => item.record.bone === first.name);
    assert.ok(Math.abs(firstState.selfRotation[2]) > 1e-5,
        `rootWeight must not pin the native root particle, got ${firstState.selfRotation}`);
});

test('native spring children retain their own state and inherit the solved parent frame', () => {
    const root = new Bone();
    root.name = 'ActorRoot';
    const first = new Bone();
    first.name = 'LeftHair1_S';
    const second = new Bone();
    second.name = 'LeftHair2_S';
    const tip = new Bone();
    tip.name = 'LeftHair3_S';
    second.position.set(1, 0, 0);
    tip.position.set(1, 0, 0);
    root.add(first);
    first.add(second);
    second.add(tip);
    root.updateMatrixWorld(true);
    const restPose = [root, first, second, tip].map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
    const record = bone => ({
        bone,
        part: 'hair',
        mass: 1,
        spring: 0,
        damping: 0,
        stiffness: 0,
        pendulum: 0,
        pendulumRange: 1,
        gravityScale: 1,
        collisionMask: 0,
        colliderType: 4,
    });
    const motion = new SecondaryMotion({
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        nativePrewarmSteps: 0,
        springs: [record(first.name), record(second.name)],
        colliders: [],
        drivers: [],
        chains: [],
    });
    motion.bind(restPose);
    const firstState = motion.springs.find(item => item.record.bone === first.name);
    const secondState = motion.springs.find(item => item.record.bone === second.name);
    assert.equal(secondState.parentSpring, firstState);
    motion.update(1 / 60);
    const childAfterFirst = [...secondState.selfRotation];
    motion.update(1 / 60);
    assert.ok(secondState.selfRotation.some((value, index) => Math.abs(value - childAfterFirst[index]) > 1e-5));
    assert.ok(firstState.selfRotation.some((value, index) => Math.abs(value - [0, 0, 0, 1][index]) > 1e-5));
    assert.ok(secondState.poseParentRootRotation.some((value, index) => Math.abs(value - [0, 0, 0, 1][index]) > 1e-5));
});

test('hair limits move the native twist lock onto the actual PMX tail axis', () => {
    const native = { useLimit: 1, axisX: [0, 0], axisY: [-5, 20], axisZ: [-40, 30] };
    const remapped = remapLimitsToTail(native, [0.1, -0.2, 1]);
    assert.deepEqual(remapped.axisZ, [0, 0]);
    assert.deepEqual(remapped.axisX, [-5, 20]);
    assert.deepEqual(remapped.axisY, [-40, 30]);
    const swing = clampExtraByLimits(eulerDegreesToQuaternionXYZ([20, 0, 0]), remapped);
    assert.ok(Math.abs(swing[0]) > 0.1, 'pitch around the braid tail must remain available');
});

test('body clothing can override the native gravity scale', () => {
    const table = { springs: [{ bone: 'LeftFrontSkirt1_S', part: 'body' }], gravityScaleByPart: { body: 0 } };
    const record = table.springs[0];
    const gravityScale = table.gravityScaleByPart[record.part];
    const withGravity = nativeSwingForce([0, 1, 0], [0, 1, 0], [0, 1, 0], { bone: record.bone, mass: 1, gravityScale: 1 }, 1);
    const withoutGravity = nativeSwingForce([0, 1, 0], [0, 1, 0], [0, 1, 0], { bone: record.bone, mass: 1, gravityScale }, 1);
    assert.ok(withGravity[1] < withoutGravity[1]);
    assert.deepEqual(withoutGravity, [0, 0, 0]);
});

test('ttmr disables skirt gravity while leaving other body gravity enabled', () => {
    const table = { gravityScaleByBoneGroup: { skirt: 0 } };
    const tuning = { gravity: 1, physics: 1 };
    assert.equal(gravityScaleForSpring({ bone: 'LeftFrontSkirt1_S', part: 'body' }, table, tuning), 0);
    assert.equal(gravityScaleForSpring({ bone: 'LeftFrontJacket1_S', part: 'body' }, table, tuning), 1);
    assert.equal(gravityScaleForSpring({ bone: 'LeftFrontHair1_S', part: 'hair' }, table, tuning), 1);
});

test('back hair can use a profile-specific gravity scale without changing front hair', () => {
    const table = { gravityScaleByBoneGroup: { backHair: 0.55 } };
    const tuning = { gravity: 1, physics: 1 };
    assert.equal(gravityScaleForSpring({ bone: 'CenterBackHair4_S', part: 'hair' }, table, tuning), 0.55);
    assert.equal(gravityScaleForSpring({ bone: 'CenterFrontHair4_S', part: 'hair' }, table, tuning), 1);
});

test('body clothing can disable the approximate angle-limit projection', () => {
    const table = { springs: [{ bone: 'LeftFrontSkirt1_S', part: 'body' }], angleLimitsByPart: { body: false } };
    assert.equal(table.angleLimitsByPart.body, false);
});

test('spring integration keeps length, collides, and separates a ring', () => {
    const rest = [0, 1, 0];
    const current = [0.2, 1, 0];
    const previous = [0.4, 1, 0];
    const next = integrateTail(previous, current, rest, { damping: 0.5, stiffness: 0.2, spring: 0, pendulum: 0 }, 1 / 60);
    assert.ok(Math.abs(next[0]) < Math.abs(current[0]));
    assert.deepEqual(constrainLength([0, 0, 0], [3, 0, 0], 2), [2, 0, 0]);
    const pushed = resolveSphere([0.01, 0, 0], 0.05, [0, 0, 0], 0.1);
    assert.ok(Math.abs(pushed[0] - 0.15) < 1e-10);
    assert.deepEqual(pushed.slice(1), [0, 0]);
    const ring = separateRing([[0, 0, 0], [0.01, 0, 0]], 0.2, false);
    assert.ok(Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1], ring[1][2] - ring[0][2]) > 0.19);
    assert.equal(masksOverlap(-1, 8), true);
    assert.equal(masksOverlap(65, 8), false);
    assert.equal(masksOverlap(65, 64), true);
    assert.ok(Math.abs(medianScale([[0.1, 1.2], [0.1, 1.2], [0.2, 2.4]]) - 12) < 1e-10);
});

test('chain separation can apply a bounded correction for over-constrained jacket layers', () => {
    const points = [[0, 0, 0], [0.01, 0, 0]];
    const originalDistance = 0.01;
    const targetDistance = 0.2;
    const partiallySeparated = separateRing(points, targetDistance, false, 0.35);
    const partialDistance = Math.hypot(
        partiallySeparated[1][0] - partiallySeparated[0][0],
        partiallySeparated[1][1] - partiallySeparated[0][1],
        partiallySeparated[1][2] - partiallySeparated[0][2],
    );
    assert.ok(partialDistance > originalDistance);
    assert.ok(partialDistance < targetDistance);
});

test('chain separation never expands a layer beyond its authored rest spacing', () => {
    const points = [[0, 0, 0], [0.01, 0, 0]];
    const separated = separateRing(points, 0.2, false, 0.35, [0.01]);
    assert.deepEqual(separated, points);
});

test('5573E010 mode 2 reduces an overlapping pair with the native asymmetric split', () => {
    const first = [0, 0, 0];
    const second = [0.05, 0, 0];
    const result = recoveredSwingPairCollision(first, second, 0.1, 0.1);
    assert.equal(result.collided, true);
    assert.ok(Math.abs(result.first[0] - 0.025) < 1e-10);
    assert.ok(Math.abs(result.second[0] - 0.05) < 1e-10);
    assert.deepEqual(first, [0, 0, 0]);
    assert.deepEqual(second, [0.05, 0, 0]);
});

test('5573E010 mode 2 ignores invalid radii and non-overlapping pairs', () => {
    const invalid = recoveredSwingPairCollision([0, 0, 0], [0.01, 0, 0], -1, Number.NaN);
    assert.equal(invalid.collided, false);
    const separated = recoveredSwingPairCollision([0, 0, 0], [0.3, 0, 0], 0.1, 0.1);
    assert.equal(separated.collided, false);
    assert.deepEqual(separated.first, [0, 0, 0]);
    assert.deepEqual(separated.second, [0.3, 0, 0]);
});

test('native dynamic masks select soft-hair and clothing contacts', () => {
    const jacket = { bone: 'LeftFrontJacket4_S', collisionMask: 65, colliderType: 0, particleRadius: 0.025 };
    const jacketRoot = { ...jacket, bone: 'LeftFrontJacket3_S' };
    const nativeSoftHair = { bone: 'LeftSideHair1_S', collisionMask: -1, colliderType: 0, particleRadius: 0.05 };
    const nativeHairTail = { bone: 'LeftSideHair8_S_End', collisionMask: 8, colliderType: 0, particleRadius: 0.02 };
    const activeHair = { bone: 'LeftSideHair2_S', collisionMask: 8, colliderType: 0, particleRadius: 0.018 };
    const skirt = { bone: 'LeftFrontSkirt1_S', collisionMask: -1, colliderType: 0, particleRadius: 0.05 };
    assert.equal(dynamicParticlePairAllowed(nativeSoftHair, jacket), true);
    assert.equal(dynamicParticlePairAllowed(nativeHairTail, jacket), false);
    assert.equal(dynamicParticlePairAllowed(activeHair, jacket), false);
    assert.equal(dynamicParticlePairAllowed(skirt, jacket), false);
    assert.equal(dynamicParticlePairAllowed(skirt, jacketRoot), false);
});

test('dynamic hair pair separates the soft layer from the jacket', () => {
    const hair = { bone: 'LeftSideHair1_S', collisionMask: -1, colliderType: 0, particleRadius: 0.05 };
    const jacket = { bone: 'LeftFrontJacket3_S', collisionMask: 65, colliderType: 0, particleRadius: 0.025 };
    const result = resolveDynamicParticlePair([0, 0, 0], [0.01, 0, 0], hair, jacket, 1);
    assert.equal(result.collided, true);
    assert.ok(result.first[0] < 0, 'the braid should be pushed away from the jacket');
    assert.deepEqual(result.second, [0.01, 0, 0], 'the jacket should not receive a feedback impulse');
});

test('skirt-jacket dynamic contact stays disabled even during approach', () => {
    const skirt = { bone: 'LeftFrontSkirt1_S', collisionMask: -1, colliderType: 0, particleRadius: 0.05 };
    const jacket = { bone: 'LeftFrontJacket3_S', collisionMask: 65, colliderType: 0, particleRadius: 0.025 };
    const resting = resolveDynamicParticlePair(
        [0, 0, 0],
        [0.01, 0, 0],
        jacket,
        skirt,
        1,
        [0, 0, 0],
        [0.01, 0, 0],
    );
    assert.equal(resting.collided, false);
    const approaching = resolveDynamicParticlePair(
        [0, 0, 0],
        [0.01, 0, 0],
        jacket,
        skirt,
        1,
        [-0.01, 0, 0],
        [0.02, 0, 0],
    );
    assert.equal(approaching.collided, false);
    const deeperThanRest = resolveDynamicParticlePair(
        [0, 0, 0],
        [0.001, 0, 0],
        jacket,
        skirt,
        1,
        [0, 0, 0],
        [0.01, 0, 0],
        [0, 0, 0],
        [0.01, 0, 0],
    );
    assert.equal(deeperThanRest.collided, false);
});

test('dynamic clothing contact stays off while the body colliders are static', () => {
    const collider = { start: [0, 0, 0], end: [0, 1, 0] };
    assert.equal(colliderGeometryMoved([collider], null), false);
    assert.equal(colliderGeometryMoved([collider], [{ start: [0, 0, 0], end: [0, 1, 0] }]), false);
    assert.equal(colliderGeometryMoved([collider], [{ start: [0.001, 0, 0], end: [0, 1, 0] }]), true);
});

test('chain tuning exposes separate skirt and jacket controls with a bounded local gap', () => {
    const motion = new SecondaryMotion();
    assert.deepEqual(motion.getTuning(), DEFAULT_SECONDARY_TUNING);
    motion.setTuning({
        chainSkirtRadius: 1.5,
        chainJacketRadius: 0.5,
        chainGap: 0.02,
        chainOrder: 'before-collision',
    });
    assert.equal(motion.getTuning().chainSkirtRadius, 1.5);
    assert.equal(motion.getTuning().chainJacketRadius, 0.5);
    assert.equal(motion.getTuning().chainGap, 0.02);
    assert.equal(motion.getTuning().chainOrder, 'before-collision');
    assert.equal(chainLayerKind({ bones: ['LeftFrontSkirt1_S'] }), 'skirt');
    assert.equal(chainLayerKind({ bones: ['LeftFrontJacket3_S'] }), 'jacket');
    assert.equal(chainLayerKind({ bones: ['Unknown'] }), 'other');
    assert.ok(Math.abs(chainLayerMinimumDistance({ bones: ['LeftFrontSkirt1_S'], radius: 0.02 }, 10, motion.getTuning()) - 0.8) < 1e-10);
    assert.ok(Math.abs(chainLayerMinimumDistance({ bones: ['LeftFrontJacket3_S'], radius: 0.02 }, 10, motion.getTuning()) - 0.4) < 1e-10);
});

test('chain tuning clamps UI values and keeps the current writeback order by default', () => {
    const motion = new SecondaryMotion();
    motion.setTuning({ chainSkirtRadius: 9, chainJacketRadius: -2, chainGap: 9, chainOrder: 'unknown' });
    const tuning = motion.getTuning();
    assert.equal(tuning.chainSkirtRadius, 2);
    assert.equal(tuning.chainJacketRadius, 0);
    assert.equal(tuning.chainGap, 0.06);
    assert.equal(tuning.chainOrder, 'after-collision');
    assert.equal(DEFAULT_SECONDARY_TUNING.chainOrder, 'after-collision');
});


test('recovered skirt profiles can include the thigh collider layer', () => {
    const record = { bone: 'LeftFrontSkirt1_S', part: 'body', collisionMask: 1 };
    assert.equal(effectiveSpringCollisionMask(record, {
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        skirtCollidesWithThigh: true,
    }), 65);
    assert.equal(effectiveSpringCollisionMask(record, {
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        skirtCollidesWithThigh: true,
        colliders: [
            { bone: 'LeftLeg', collisionMask: 1 },
            { bone: 'RightLeg', collisionMask: 1 },
        ],
    }), 65);
    assert.equal(effectiveSpringCollisionMask(record, {
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        skirtCollidesWithThigh: false,
    }), 1);
    assert.equal(effectiveSpringCollisionMask(record, { physicsAlgorithm: 'legacy' }), 1);
});

test('recovered skirt thigh layer does not activate unrelated mask-64 body colliders', () => {
    const record = { bone: 'LeftFrontSkirt1_S', part: 'body', collisionMask: 1 };
    const table = {
        physicsAlgorithm: RECOVERED_PHYSICS_ALGORITHM,
        skirtCollidesWithThigh: true,
        colliders: [
            { bone: 'LeftUpLeg', collisionMask: 64 },
            { bone: 'Spine', collisionMask: 64 },
        ],
    };
    assert.equal(nativeStaticColliderAllowed(record, { mask: 64, record: { bone: 'LeftUpLeg' } }, table), true);
    assert.equal(nativeStaticColliderAllowed(record, { mask: 64, record: { bone: 'Spine' } }, table), false);
    assert.equal(nativeStaticColliderAllowed(record, { mask: 1, record: { bone: 'Hips' } }, table), true);
});

test('clothing particle radius is included when resolving body collision', () => {
    const withoutParticle = resolveSphere([0.14, 0, 0], 0, [0, 0, 0], 0.1);
    const withParticle = resolveSphere([0.14, 0, 0], 0.05, [0, 0, 0], 0.1);
    assert.ok(withoutParticle[0] < 0.15);
    assert.ok(Math.abs(withParticle[0] - 0.15) < 1e-10);
});

test('skirt particle shell can be scoped to the captured thigh colliders', () => {
    const skirt = { bone: 'LeftFrontSkirt2_S', particleRadius: 0 };
    const child = { particleRadius: 0.03 };
    const table = {
        skirtStaticParticleRadius: 'tail-particle',
        skirtStaticParticleRadiusColliders: ['LeftLeg', 'RightLeg'],
        skirtStaticParticleRadiusParticles: ['LeftFrontSkirt2_S'],
        skirtStaticParticleRadiusScale: 0.4,
    };
    assert.ok(Math.abs(springStaticParticleRadiusForCollider(skirt, child, { bone: 'LeftLeg' }, table, 12.5) - 0.15) < 1e-9);
    assert.equal(springStaticParticleRadiusForCollider(skirt, child, { bone: 'Hips' }, table, 12.5), 0);
    assert.equal(springStaticParticleRadiusForCollider({ bone: 'LeftBackSkirt2_S' }, child, { bone: 'LeftLeg' }, table, 12.5), 0);
});

test('KLLJ body springs use the captured child collision radius', () => {
    for (const rootName of ['CenterLeftRibbon1_S', 'CenterLeftLRibbon1_S', 'CenterCollar1_S']) {
        const root = klljTable.springs.find(item => item.bone === rootName);
        const child = klljTable.springs.find(item => item.nativeDynamicIndex === root.nativeChildIndex);
        assert.ok(root && child, rootName);
        const radius = springStaticParticleRadius(root, child, klljTable, 12.5);
        assert.ok(Math.abs(radius - child.particleRadius * 12.5) < 1e-8, rootName);
        assert.ok(radius < root.particleRadius * 12.5, rootName);
    }
});

test('KLLJ front skirt and visible hem retain their captured thickness against the legs', () => {
    const ends = klljTable.springs.filter(item => /Skirt4_S_End$/.test(item.bone));
    assert.equal(ends.length, 8);
    for (const end of ends) {
        const owner = klljTable.springs.find(item => item.nativeChildIndex === end.nativeDynamicIndex);
        assert.ok(owner, `${end.bone} must have a spring that moves its visible joint`);
        const leg = { bone: end.bone.startsWith('Right') ? 'RightLeg' : 'LeftLeg' };
        const expected = end.particleRadius * 12.5;
        for (const record of [owner, end]) {
            const radius = springStaticParticleRadiusForCollider(record, end, leg, klljTable, 12.5);
            assert.ok(Math.abs(radius - expected) < 1e-8, `${record.bone} lost ${end.bone}'s authored thickness`);
            assert.equal(springStaticParticleRadiusForCollider(record, end, { bone: 'Spine2' }, klljTable, 12.5), 0);
        }
        // A hem particle just outside the leg surface still needs separation
        // by its own thickness; a zero-radius point would miss this contact.
        const separated = resolveSphere([1 + expected / 2, 0, 0],
            springStaticParticleRadiusForCollider(owner, end, leg, klljTable, 12.5), [0, 0, 0], 1);
        assert.ok(Math.abs(separated[0] - (1 + expected)) < 1e-8, end.bone);
    }
    for (const name of ['LeftFrontSkirt1_S', 'LeftFrontSkirt2_S']) {
        const record = klljTable.springs.find(item => item.bone === name);
        const child = klljTable.springs.find(item => item.nativeDynamicIndex === record.nativeChildIndex);
        assert.ok(Math.abs(springStaticParticleRadiusForCollider(record, child, { bone: 'LeftLeg' }, klljTable, 12.5)
            - child.particleRadius * 12.5) < 1e-8, `${name} must use its captured child thickness`);
    }
    const sideUpper = klljTable.springs.find(item => item.bone === 'LeftBackSideSkirt2_S');
    const sideChild = klljTable.springs.find(item => item.nativeDynamicIndex === sideUpper.nativeChildIndex);
    assert.equal(springStaticParticleRadiusForCollider(sideUpper, sideChild, { bone: 'LeftLeg' }, klljTable, 12.5), 0,
        'side and back upper skirt shells remain scoped out');
});

test('skirt pitch around X is kept when the unity twist lock is moved onto the PMX chain', () => {
    const limits = { useLimit: 1, axisX: [0, 0], axisY: [-30, 30], axisZ: [-30, 30] };
    const remapped = remapLimitsToTail(limits, [0.07, -1.55, -0.13]);
    assert.deepEqual(remapped.axisY, [0, 0]);
    const pitched = clampExtraByLimits(eulerDegreesToQuaternionXYZ([20, 0, 0]), remapped);
    const euler = quaternionToEulerDegreesXYZ(pitched);
    assert.ok(Math.abs(euler[0] - 20) < 1, 'a bow pitch must survive the spring limit');
    assert.ok(Math.abs(euler[1]) < 1);
    const twist = clampExtraByLimits(eulerDegreesToQuaternionXYZ([0, 25, 0]), remapped);
    const twistEuler = quaternionToEulerDegreesXYZ(twist);
    assert.ok(Math.abs(twistEuler[1]) < 1, 'twist along the skirt chain stays locked');
});

test('angle limits can lock the twist axis', () => {
    const extra = clampExtraByLimits(eulerDegreesToQuaternionXYZ([20, 0, 0]), { useLimit: 1, axisX: [0, 0], axisY: [-180, 180], axisZ: [-180, 180] });
    const euler = quaternionToEulerDegreesXYZ(extra).map(value => Object.is(value, -0) ? 0 : value);
    assert.ok(Math.abs(euler[0]) < 1e-6);
    assert.ok(Math.abs(euler[1]) < 1e-6);
    assert.ok(Math.abs(euler[2]) < 1e-6);
    const swung = clampExtraByLimits(eulerDegreesToQuaternionXYZ([0, 25, 0]), { useLimit: 1, axisX: [0, 0], axisY: [-40, 40], axisZ: [-40, 40] });
    const swungEuler = quaternionToEulerDegreesXYZ(swung);
    assert.ok(Math.abs(swungEuler[1]) > 5);
});

test('left skirt particles skip the right thigh so they cannot tunnel across', () => {
    assert.equal(skipsContralateralLegCollider('LeftFrontSkirt1_S', 'RightLeg'), true);
    assert.equal(skipsContralateralLegCollider('LeftFrontSkirt1_S', 'RightUpLeg'), true);
    assert.equal(skipsContralateralLegCollider('LeftFrontSkirt1_S', 'LeftLeg'), false);
    assert.equal(skipsContralateralLegCollider('RightBackSkirt2_S', 'LeftUpLeg'), true);
    assert.equal(skipsContralateralLegCollider('LeftFrontSkirt1_S', 'Spine1'), false);
    assert.equal(skipsContralateralLegCollider('Hips', 'RightLeg'), false);
});

test('braid and hair particles keep the native Spine2 collision layer', () => {
    assert.equal(skipsHairSpineCollider('LeftSideHair1_S', 'Spine2'), true);
    assert.equal(skipsHairSpineCollider('LeftSideHair1_S', 'Neck'), true);
    assert.equal(skipsHairSpineCollider('LeftSideHair5_S', 'Spine2'), false);
    assert.equal(skipsHairSpineCollider('RightSideHair8_S_End', 'Spine02'), false);
    assert.equal(skipsHairSpineCollider('LeftBackInHair1_S', 'Spine2'), false);
    assert.equal(skipsHairSpineCollider('LeftSideHair5_S', 'Spine1'), false);
    assert.equal(skipsHairSpineCollider('LeftSideHair5_S', 'Neck'), false);
    assert.equal(skipsHairSpineCollider('LeftSideHair5_S', 'Head_Face'), false);
    assert.equal(skipsHairRootFaceCollider('LeftSideHair1_S', 'Head_Face'), false);
    assert.equal(skipsHairRootFaceCollider('RightSideHair1_S', 'Head_Face'), false);
    assert.equal(skipsHairRootFaceCollider('LeftSideHair2_S', 'Head_Face'), false);
    assert.equal(skipsHairRootFaceCollider('LeftFrontJacket1_S', 'Head_Face'), false);
    assert.equal(skipsHairSpineCollider('LeftFrontJacket3_S', 'Spine2'), false);
    assert.equal(skipsHairSpineCollider('LeftFrontSkirt1_S', 'Spine2'), false);
});

test('HSKI HairSide and SideHair root links use the child collision radius from Unity', () => {
    const head = hskiTable.colliders.find(item => item.bone === 'Head_Face');
    assert.ok(head);
    for (const rootName of ['LeftHairSide1_S', 'RightHairSide1_S', 'LeftSideHair1_S', 'RightSideHair1_S']) {
        const root = hskiTable.springs.find(item => item.bone === rootName);
        const child = hskiTable.springs.find(item => item.nativeDynamicIndex === root.nativeChildIndex);
        assert.ok(child, rootName);
        const radius = springStaticParticleRadius(root, child, hskiTable, 1);
        assert.ok(Math.abs(radius - child.particleRadius) < 1e-6, rootName);
        assert.ok(radius < root.particleRadius, rootName);
        const rest = child.modelingWorldPosition;
        const projected = resolveCapsuleKeepSide(rest, radius, head.unityOffsetA, head.unityOffsetB,
            head.radiusA, head.radiusB, rest);
        assert.deepEqual(projected, rest, `${rootName} should not be pushed out of Head_Face in the captured rest pose`);
    }
});

test('HSKI side-hair roots retain their native Head_Face collision path', () => {
    const rule = hskiTable.hairRootColliderSkip.find(item => item?.colliders?.includes('Head_Face')
        && item?.particles?.includes('LeftBackHair1_S'));
    const roots = ['LeftHairSide1_S', 'RightHairSide1_S', 'LeftSideHair1_S', 'RightSideHair1_S'];
    assert.ok(rule);
    for (const bone of roots) assert.equal(skipsConfiguredHairRootCollider(bone, 'Head_Face', hskiTable), false);
    assert.equal(skipsConfiguredHairRootCollider('LeftHairSide2_S', 'Head_Face', hskiTable), false);
    assert.equal(skipsConfiguredHairRootCollider('LeftSideHair1_S', 'Neck', hskiTable), false);
    assert.ok(roots.every(bone => !rule.particles.includes(bone)));
    assert.deepEqual(rule.colliders, ['Head_Face']);
});

test('HSKI side hair skips the oversized Spine2 mask-16 volume as one chain', () => {
    const collider = { bone: 'Spine2', collisionMask: 16 };
    assert.equal(skipsConfiguredHairStaticCollider({ bone: 'LeftSideHair1_S', part: 'hair' }, collider, hskiTable), true);
    for (const bone of ['LeftSideHair2_S', 'LeftSideHair3_S', 'LeftSideHair4_S_End', 'RightSideHair2_S', 'RightSideHair3_S', 'RightSideHair4_S_End']) {
        assert.equal(skipsConfiguredHairStaticCollider({ bone, part: 'hair' }, collider, hskiTable), true, bone);
    }
});

test('native static collision uses the child mask even when its dynamic type is None', () => {
    assert.equal(hasStaticSpringCollision({ colliderType: 4, collisionMask: 64 }), true);
    assert.equal(hasStaticSpringCollision({ colliderType: 0, collisionMask: 0 }), false);
});

test('HSKI disables the over-large LRibbon static collision path only', () => {
    for (const bone of ['CenterLeftLRibbon1_S', 'CenterLeftLRibbon2_S_End', 'CenterRightLRibbon1_S', 'CenterRightRRibbon2_S_End']) {
        assert.equal(hasStaticSpringCollision({ bone, part: 'body', colliderType: 4, collisionMask: 64 }, hskiTable), false, bone);
    }
    assert.equal(hasStaticSpringCollision({ bone: 'CenterLeftRibbon1_S', part: 'body', colliderType: 0, collisionMask: 64 }, hskiTable), true);
    assert.equal(hasStaticSpringCollision({ bone: 'LeftSideHair2_S', part: 'hair', colliderType: 0, collisionMask: 16 }, hskiTable), true);
});

test('KLLJ skips torso collisions for the captured bow root pair only', () => {
    const rule = {
        staticCollisionSkipPairs: {
            particles: ['CenterLeftRibbon1_S', 'CenterRightRibbon1_S'],
            colliders: ['Spine1', 'Spine2', 'Neck'],
        },
    };
    assert.equal(skipsConfiguredStaticCollisionPair({ bone: 'CenterLeftRibbon1_S' }, { bone: 'Spine1' }, rule), true);
    assert.equal(skipsConfiguredStaticCollisionPair({ bone: 'CenterRightRibbon1_S' }, { bone: 'Neck' }, rule), true);
    assert.equal(skipsConfiguredStaticCollisionPair({ bone: 'CenterLeftRibbon2_S' }, { bone: 'Spine1' }, rule), false);
    assert.equal(skipsConfiguredStaticCollisionPair({ bone: 'CenterLeftRibbon1_S' }, { bone: 'Head_Face' }, rule), false);
});

test('HSKI RightBackSideRHair uses the GLB local limit path', () => {
    assert.equal(shouldUseNativeParticleHairLimit({ bone: 'RightBackSideRHair2_S', part: 'hair' }, hskiTable), false);
    assert.equal(shouldUseNativeParticleHairLimit({ bone: 'RightBackSideRHair4_S', part: 'hair' }, hskiTable), false);
    assert.equal(shouldUseNativeParticleHairLimit({ bone: 'RightBackSideLHair2_S', part: 'hair' }, hskiTable), true);
});

test('temari hair roots skip torso colliders from their own profile rule', () => {
    const ttmr = {
        hairSpineColliderSkip: {
            particles: ['LeftHair1_S', 'RightHair1_S', 'LeftBackHair1_S', 'LeftFrontSideHair1_S'],
            colliders: ['Spine2', 'Spine02', 'Neck', 'Spine1'],
        },
    };
    assert.equal(skipsHairSpineCollider('LeftHair1_S', 'Spine2', ttmr), true);
    assert.equal(skipsHairSpineCollider('LeftHair1_S', 'Neck', ttmr), true);
    assert.equal(skipsHairSpineCollider('LeftHair1_S', 'Spine1', ttmr), true);
    assert.equal(skipsHairSpineCollider('LeftHair2_S', 'Spine2', ttmr), false);
    assert.equal(skipsHairSpineCollider('LeftSideHair1_S', 'Spine2', ttmr), false);
    assert.equal(skipsHairSpineCollider('LeftFrontJacket1_S', 'Spine2', ttmr), false);
    // Without a profile override, Kotone's SideHair1 default remains.
    assert.equal(skipsHairSpineCollider('LeftHair1_S', 'Spine2'), false);
    assert.equal(skipsHairSpineCollider('LeftSideHair1_S', 'Spine2'), true);
});

test('temari hair roots skip only the configured head and torso colliders', () => {
    const ttmr = {
        hairRootColliderSkip: {
            particles: ['CenterFrontHair1_S', 'RightFrontTopSideHair1_S'],
            colliders: ['Head', 'Head_Face', 'Spine2', 'Spine1'],
        },
    };
    assert.equal(skipsConfiguredHairRootCollider('CenterFrontHair1_S', 'Head_Face', ttmr), true);
    assert.equal(skipsConfiguredHairRootCollider('RightFrontTopSideHair1_S', 'Spine2', ttmr), true);
    assert.equal(skipsConfiguredHairRootCollider('CenterFrontHair2_S', 'Head_Face', ttmr), false);
    assert.equal(skipsConfiguredHairRootCollider('CenterFrontHair1_S', 'Neck', ttmr), false);
});

test('temari front-top-side hair follows its current rest direction instead of braid world-down carry', () => {
    const ttmr = { hairRestTailMode: 'braid-and-back' };
    assert.equal(shouldPreserveHairRestTail('LeftSideHair2_S', ttmr), true);
    assert.equal(shouldPreserveHairRestTail('RightSideBackCHair2_S', ttmr), true);
    assert.equal(shouldPreserveHairRestTail('LeftFrontTopSideHair2_S', ttmr), false);
    assert.equal(shouldPreserveHairRestTail('CenterFrontHair2_S', ttmr), false);
});

test('temari back hair keeps its world rest direction together with the braids', () => {
    const ttmr = { hairRestTailMode: 'braid-and-back' };
    assert.equal(shouldPreserveHairRestTail('LeftSideHair2_S', ttmr), true);
    assert.equal(shouldPreserveHairRestTail('RightSideBackCHair2_S', ttmr), true);
    assert.equal(shouldPreserveHairRestTail('CenterBackHair4_S', ttmr), true);
    assert.equal(shouldPreserveHairRestTail('LeftBackSideHair5_S', ttmr), true);
});

test('temari back hair uses the native local frame from segment two onward', () => {
    const profile = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../secondary-motion-profiles/ttmr.json'), 'utf8'));
    const first = profile.springs.find(item => item.bone === 'CenterBackHair1_S');
    const second = profile.springs.find(item => item.bone === 'CenterBackHair2_S');
    assert.equal(second.nativeBoneAxis[0], -1);
    assert.ok(Math.abs(second.nativeBoneAxis[1]) < 1e-6);
    assert.ok(Math.abs(second.nativeBoneAxis[2]) < 1e-6);
    assert.equal(nativeHairLimitFrame(first, [0, 1, 0]), null);
    assert.ok(nativeHairLimitFrame(second, [0, 1, 0]));
    const limited = clampExtraByNativeHairFrame([0, 0, 0, 1], second, [0, 1, 0]);
    assert.ok(limited.every(Number.isFinite));
});

test('temari front-top side hair uses the native local frame from segment two onward', () => {
    const profile = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../secondary-motion-profiles/ttmr-casl.json'), 'utf8'));
    const first = profile.springs.find(item => item.bone === 'LeftFrontTopSideHair1_S');
    const second = profile.springs.find(item => item.bone === 'LeftFrontTopSideHair2_S');
    assert.equal(nativeHairLimitFrame(first, [0, 1, 0]), null);
    assert.ok(nativeHairLimitFrame(second, [0, 1, 0]));
});

test('large Spine2 hair collider does not push skirt particles through the all-mask fallback', () => {
    assert.equal(skipsLargeSpineSkirtCollider('LeftFrontSkirt1_S', 'Spine2', 16), true);
    assert.equal(skipsLargeSpineSkirtCollider('LeftSideHair3_S', 'Spine2', 16), false);
    assert.equal(skipsLargeSpineSkirtCollider('LeftFrontSkirt1_S', 'Spine2', 8), false);
});

test('skirt thigh contact keeps the particle-radius classification', () => {
    assert.equal(skirtThighCollider('LeftBackSkirt1_S', 'LeftUpLeg'), true);
    assert.equal(skirtThighCollider('LeftBackSkirt1_S', 'LeftLeg'), true);
    assert.equal(skirtThighCollider('LeftFrontHair1_S', 'LeftUpLeg'), false);
    assert.equal(skirtThighCollider('LeftBackSkirt1_S', 'Spine'), false);
    assert.equal(staticParticleRadius('LeftBackSkirt1_S', 0.05, 12.5), 0);
    assert.ok(Math.abs(staticParticleRadius('LeftFrontJacket1_S', 0.02, 12.5) - 0.25) < 1e-6);
    const rest = [0.2, 1, 1.2];
    const touched = [0.2, 1, 0.9];
    const pushed = resolveCapsuleKeepSide(touched, 0.05, [0, 0, 0], [0, 2, 0], 1, 1, rest);
    assert.ok(pushed[2] > touched[2], 'a thigh touch still pushes the hem out');
    assert.ok(pushed[2] > 1.02, 'the native particle thickness is included at the thigh');
});

test('native skirt chain thigh contact can use a profile-only cloth shell', () => {
    const link = { radiusA: 0.005, radiusB: 0.007 };
    assert.ok(Math.abs(nativeChainCollisionRadius(link, 'LeftBackSkirt1_S', 'LeftFrontSkirt1_S', 'LeftLeg', 12.5, { nativeSkirtThighCollisionRadiusScale: 1.25 }) - 0.109375) < 1e-9);
    assert.ok(Math.abs(nativeChainCollisionRadius(link, 'LeftBackSkirt1_S', 'LeftFrontSkirt1_S', 'RightLeg', 12.5, { nativeSkirtThighCollisionRadiusScale: 1.25 }) - 0.0875) < 1e-9);
});

test('capsule collision stays on the rest side instead of exiting through the opposite thigh', () => {
    const rest = [-0.5, 1, 0];
    const tunneled = [0.2, 1, 0];
    const naive = resolveCapsule(tunneled, 0, [0, 0, 0], [0, 2, 0], 1, 1);
    assert.ok(naive[0] > 0, 'plain projection follows the tunneled side');
    const kept = resolveCapsuleKeepSide(tunneled, 0, [0, 0, 0], [0, 2, 0], 1, 1, rest);
    assert.ok(kept[0] < 0, 'left rest should keep the particle on the left');
    assert.ok(Math.abs(kept[0] + 1) < 1e-6);
    assert.ok(Math.abs(kept[1] - 1) < 1e-6);
});

test('chain capsule collision translates the whole segment like Unity swing', () => {
    const result = resolveCapsuleSegmentCollision(
        [-0.5, 0, 0], [0.5, 0, 0], 0.1,
        [0, -1, 0], [0, 1, 0], 0.2, 0.2,
    );
    assert.equal(result.collided, true);
    assert.ok(result.correction > 0.29 && result.correction < 0.31);
    assert.ok(Math.abs(result.first[1] - result.second[1]) < 1e-6);
    assert.ok(result.first[1] > 0.29 && result.second[1] > 0.29);
});

test('FKTN jacket does not copy the skirt UpLeg correction', () => {
    assert.equal(APPLY_JACKET_SKIRT_FOLLOW, false);
    assert.equal(jacketSkirtAnchor('LeftFrontJacket3_S'), 'LeftFrontSkirt_A');
    assert.equal(jacketSkirtAnchor('RightBackSideJacket3_S'), 'RightBackSideSkirt_A');
    const jackets = selectJacketFollowDrivers(table);
    assert.equal(jackets.length, 0);
});

test('long authored body colliders remain capsules instead of becoming giant spheres', () => {
    const shape = authoredColliderShape({ type: 1, offsetA: [0, -0.123, -0.181], offsetB: [0, 0.725, 0], radiusA: 0.3, radiusB: 0.3 }, 1);
    assert.equal(shape.kind, 'capsule');
    assert.ok(Math.abs(shape.unityLength - Math.hypot(0.848, 0.181)) < 0.001);
});

test('authored colliders keep Unity meters until scale is applied', () => {
    const thigh = authoredColliderShape({ type: 1, offsetA: [-0.05, 0.035, -0.01], offsetB: [0, 0.01, 0], radiusA: 0.06, radiusB: 0.06 }, 1);
    assert.equal(thigh.kind, 'capsule');
    assert.ok(Math.abs(thigh.unityLength - 0.057) < 0.01);
    const neck = authoredColliderShape({ type: 1, offsetA: [0, 0.02, 0.01], offsetB: [1, 0.001, 0], radiusA: 0.04, radiusB: 0.04 }, 1);
    assert.equal(neck.kind, 'capsule');
    const hand = authoredColliderShape({ type: 2, offsetA: [0, 0, 0], offsetB: [0, 0, 0], radiusA: 0.02, radiusB: 0.03 }, 12.5);
    assert.equal(hand.kind, 'sphere');
    assert.ok(Math.abs(hand.radiusA - 0.375) < 1e-6);
});

test('baked pmx-local colliders are used as-is', () => {
    const shin = authoredColliderShape({
        space: 'pmxLocal',
        kind: 'capsule',
        offsetA: [0, 0, 0],
        offsetB: [0.25, 1.82, -0.87],
        radiusA: 0.08,
        radiusB: 0.08,
        unityLength: 0.16,
    }, 12.5);
    assert.equal(shin.kind, 'capsule');
    assert.equal(shin.localB[1], 1.82);
    assert.ok(Math.abs(shin.radiusA - 1) < 1e-6);
    const spine2 = authoredColliderShape({
        space: 'pmxLocal',
        kind: 'capsule',
        offsetA: [0, -0.25, 0.06],
        offsetB: [0, 2.43, 0.37],
        radiusA: 0.09,
        radiusB: 0.09,
    }, 12.5);
    assert.ok(spine2.localB[1] < 3);
});

test('Spine2 uses the recovered native horizontal chest capsule', () => {
    const kotone = JSON.parse(readFileSync(new URL('../secondary-motion-profiles/fktn.json', import.meta.url), 'utf8'));
    for (const profile of [table, kotone]) {
        const spine2 = profile.colliders.find(item => item.bone === 'Spine2' && item.collisionMask === 8);
        assert.ok(spine2);
        // Unity -> PMX -> MMDLoader: (-x, y, z) * 12.5.
        assert.deepEqual(spine2.offsetA, [0.59375, -0.25, -0.0625]);
        assert.deepEqual(spine2.offsetB, [-0.59375, -0.25, -0.0625]);
        const shape = authoredColliderShape(spine2, 12.5);
        const besideNeck = [0.8, 1.5, 0];
        assert.deepEqual(resolveCapsule(besideNeck, 0.15, shape.localA, shape.localB, shape.radiusA, shape.radiusB), besideNeck);
        const touchingChest = [0.7, -0.2, 0];
        assert.notDeepEqual(resolveCapsule(touchingChest, 0.15, shape.localA, shape.localB, shape.radiusA, shape.radiusB), touchingChest);
    }
});

test('aimed leg capsules follow their aim bone instead of frozen baked local endpoints', () => {
    const entry = { bone: { matrixWorld: { elements: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ] } } };
    const aim = { bone: { matrixWorld: { elements: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 10, 0, 1,
    ] } } };
    const shape = authoredColliderShape({
        space: 'pmxLocal',
        kind: 'capsule',
        offsetA: [1, 2, 3],
        offsetB: [4, 5, 6],
        radiusA: 0.1,
        radiusB: 0.1,
    }, 1);
    const ends = colliderWorldEnds({ space: 'pmxLocal', aimBone: 'LeftLeg' }, entry, aim, shape, 1);
    assert.deepEqual(ends.start, [0, 0, 0]);
    assert.deepEqual(ends.end, [0, 10, 0]);
});

test('ttmr keeps the aimed type-2 leg segment for skirt contacts', () => {
    assert.notEqual(ttmrTable.nativeStaticType2UseCapturedEndpoints, true);
    const entry = { bone: { matrixWorld: { elements: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ] } } };
    const aim = { bone: { matrixWorld: { elements: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 10, 0, 1,
    ] } } };
    const shape = authoredColliderShape({
        space: 'pmxLocal',
        kind: 'capsule',
        offsetA: [0, 0.02, 0],
        offsetB: [0, 0, 0],
        radiusA: 0.05,
        radiusB: 0.065,
    }, 12.5);
    const ends = colliderWorldEnds(
        { space: 'pmxLocal', nativeGeometry: true, type: 2, aimBone: 'LeftUpLeg', nativePair: [0, 0.02] },
        entry,
        aim,
        shape,
        12.5,
    );
    assert.deepEqual(ends.start, [0, 0, 0]);
    assert.deepEqual(ends.end, [0, 9.75, 0]);
});

test('native type-2 endpoint trimming follows the hip-to-knee segment', () => {
    const entry = { bone: { matrixWorld: { elements: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ] } } };
    const aim = { bone: { matrixWorld: { elements: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 10, 0, 1,
    ] } } };
    const shape = authoredColliderShape({ space: 'pmxLocal', kind: 'capsule', offsetA: [0, 0, 0], offsetB: [0, 10, 0], radiusA: 1, radiusB: 1 }, 1);
    const ends = colliderWorldEnds({ aimBone: 'LeftUpLeg', nativePair: [0.1, 0.2], nativeScale: 1 }, entry, aim, shape, 12.5);
    assert.deepEqual(ends.start, [0, 1.25, 0]);
    assert.deepEqual(ends.end, [0, 7.5, 0]);
});

test('recovered type-2 static colliders apply the native asymmetric endpoint pass', () => {
    const result = applyRecoveredStaticColliderPair(
        { type: 2, nativePair: [0.1, 0.1], nativeScale: 1 },
        [0, 0, 0],
        [0.05, 0, 0],
    );
    assert.equal(result.collided, true);
    assert.ok(Math.abs(result.first[0] - 0.025) < 1e-10);
    assert.ok(Math.abs(result.second[0] - 0.05) < 1e-10);
});

test('playlist reset restores spring tails so the next clip does not inherit velocity', () => {
    const identity = [0, 0, 0, 1];
    const parent = fakeBone('LeftSideHair_A', identity);
    const bone = fakeBone('LeftSideHair1_S', identity);
    parent.children = [bone];
    bone.parent = parent;
    parent.matrixWorld = { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };
    bone.matrixWorld = { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]) };
    parent.updateMatrixWorld = () => {};
    bone.updateMatrixWorld = () => {};
    bone.position = { toArray: () => [0, 1, 0] };
    const motion = new SecondaryMotion({
        drivers: [],
        springs: [{ bone: 'LeftSideHair1_S', damping: 0.2, stiffness: 0.05, spring: 0, pendulum: 0, collisionMask: 0, colliderType: 0, particleRadius: 0.02, unityLocalPosition: [0, 0.1, 0], limitInfo: { useLimit: 0 } }],
        colliders: [],
        chains: [],
    });
    motion.bind([
        { bone: parent, quaternion: { toArray: () => [...identity] }, position: { toArray: () => [0, 0, 0] } },
        { bone, quaternion: { toArray: () => [...identity] }, position: { toArray: () => [0, 1, 0] } },
    ]);
    assert.equal(motion.springs.length, 1);
    motion.springs[0].current = [0.4, 1, 0];
    motion.springs[0].previous = [0.8, 1, 0];
    motion.reset();
    assert.deepEqual(motion.springs[0].current, motion.springs[0].previous);
});

test('end bones continue along the PMX chain instead of Unity local X', () => {
    const tail = continueAlongRest([0.07, -1.55, 0.13], 0.124, 12.5);
    assert.ok(tail[0] > 0, 'left chain should keep a positive THREE X');
    assert.ok(tail[1] < 0, 'skirt chain should keep going down');
    assert.ok(Math.abs(tail[0]) < Math.abs(tail[1]));
    const rawUnity = [-0.124 * 12.5, 0, 0];
    assert.ok(rawUnity[0] < 0, 'raw Unity local X would have jumped to the character right');
});

test('end spring without a child stays on the same side as its rest bone', () => {
    const identity = [0, 0, 0, 1];
    const parent = fakeBone('LeftFrontSkirt2_S', identity);
    const bone = fakeBone('LeftFrontSkirt3_S_End', identity);
    parent.children = [bone];
    bone.parent = parent;
    parent.matrixWorld = { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.58, 9.97, -1.17, 1]) };
    bone.matrixWorld = { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.62, 9.01, -1.25, 1]) };
    parent.updateMatrixWorld = () => {};
    bone.updateMatrixWorld = () => {};
    bone.position = { toArray: () => [0.04, -0.96, -0.08] };
    const motion = new SecondaryMotion({
        drivers: [],
        springs: [{ bone: 'LeftFrontSkirt3_S_End', damping: 0.2, stiffness: 0.05, spring: 0, pendulum: 0, collisionMask: -1, colliderType: 0, particleRadius: 0.01, unityLocalPosition: [-0.124, 0, 0], limitInfo: { useLimit: 0 } }],
        colliders: [],
        chains: [],
    });
    motion.bind([
        { bone: parent, quaternion: { toArray: () => [...identity] }, position: { toArray: () => [0.07, -1.55, 0.13] } },
        { bone, quaternion: { toArray: () => [...identity] }, position: { toArray: () => [0.04, -0.96, -0.08] } },
    ]);
    assert.equal(motion.springs.length, 1);
    assert.ok(motion.springs[0].current[0] > 0, 'left hem particle must not teleport to -X');
    assert.ok(motion.springs[0].tailLocal[1] < 0);
});

test('coincident skin bones are not given a fake tail', () => {
    const identity = [0, 0, 0, 1];
    const parent = fakeBone('LeftUpLeg', identity);
    const skin1 = fakeBone('LeftUpLegSkin1_S', identity);
    const skin2 = fakeBone('LeftUpLegSkin2_S', identity);
    parent.children = [skin1];
    skin1.children = [skin2];
    skin1.parent = parent;
    skin2.parent = skin1;
    const identityMatrix = { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };
    parent.matrixWorld = identityMatrix;
    skin1.matrixWorld = identityMatrix;
    skin2.matrixWorld = identityMatrix;
    parent.updateMatrixWorld = () => {};
    skin1.updateMatrixWorld = () => {};
    skin2.updateMatrixWorld = () => {};
    skin1.position = { toArray: () => [0, 0, 0] };
    skin2.position = { toArray: () => [0, 0, 0] };
    const motion = new SecondaryMotion({
        drivers: [],
        springs: [
            { bone: 'LeftUpLegSkin1_S', damping: 0.07, stiffness: 0, spring: 0.8, pendulum: 0, collisionMask: -1, colliderType: 4, particleRadius: 0.05, unityLocalPosition: [0, 0, 0], limitInfo: { useLimit: 0 } },
        ],
        colliders: [],
        chains: [],
    });
    motion.bind([
        { bone: parent, quaternion: { toArray: () => [...identity] }, position: { toArray: () => [0, 0, 0] } },
        { bone: skin1, quaternion: { toArray: () => [...identity] }, position: { toArray: () => [0, 0, 0] } },
        { bone: skin2, quaternion: { toArray: () => [...identity] }, position: { toArray: () => [0, 0, 0] } },
    ]);
    assert.equal(motion.springs.length, 0);
});

test('spring particles travel with the parent so a posed leg does not ring', () => {
    const identity = [0, 0, 0, 1];
    const parent = fakeBone('LeftFrontSkirt_A', identity);
    const bone = fakeBone('LeftFrontSkirt1_S', identity);
    parent.children = [bone];
    bone.parent = parent;
    parent.matrixWorld = { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) };
    bone.matrixWorld = { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]) };
    parent.updateMatrixWorld = () => {};
    bone.updateMatrixWorld = () => {};
    bone.position = { toArray: () => [0, 1, 0] };
    const motion = new SecondaryMotion({
        drivers: [],
        springs: [{ bone: 'LeftFrontSkirt1_S', damping: 1, stiffness: 0, spring: 0, pendulum: 0, collisionMask: 0, colliderType: 4, particleRadius: 0.02, unityLocalPosition: [0, 0.1, 0], limitInfo: { useLimit: 0 } }],
        colliders: [],
        chains: [],
    });
    motion.bind([
        { bone: parent, quaternion: { toArray: () => [...identity] }, position: { toArray: () => [0, 0, 0] } },
        { bone, quaternion: { toArray: () => [...identity] }, position: { toArray: () => [0, 1, 0] } },
    ]);
    bone.matrixWorld = { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.4, 1, 0, 1]) };
    motion.update(1 / 60);
    assert.ok(Math.abs(motion.springs[0].current[0] - 0.4) < 1e-6);
    assert.ok(Math.abs(motion.springs[0].current[1] - 2) < 1e-6);
});

test('spring particles rotate with the rest tail so a swinging thigh does not pop the skirt', () => {
    const carried = carryParticleWithRest([0, 1, 0], [0, 1, 0], [0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    assert.ok(Math.abs(carried.current[0] - 1) < 1e-6);
    assert.ok(Math.abs(carried.current[1]) < 1e-6);
});

test('native skirt carrier rotates the stored particle state with the thigh', () => {
    const quarterTurn = eulerDegreesToQuaternionXYZ([0, 0, 90]);
    const carried = carryParticleWithCarrier(
        [1, 0, 0],
        [0.8, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0, 1],
        quarterTurn,
    );
    assert.ok(Math.abs(carried.current[0]) < 1e-6);
    assert.ok(Math.abs(carried.current[1] - 1) < 1e-6);
    assert.ok(Math.abs(carried.previous[0]) < 1e-6);
    assert.ok(Math.abs(carried.previous[1] - 0.8) < 1e-6);
});

test('skirt root motion keeps a weighted relative displacement against the legs', () => {
    const delta = relativeRootMotionDelta([1, 2, 3], { bone: 'LeftFrontSkirt2_S', rootWeight: 0.3 }, 1);
    assert.ok(delta.every((value, index) => Math.abs(value - [0.7, 1.4, 2.1][index]) < 1e-9));
    assert.deepEqual(relativeRootMotionDelta([1, 2, 3], { bone: 'LeftBackHair1_S', rootWeight: 0.3 }, 1), [0, 0, 0]);
});

test('braid particles keep their world down direction when the head raises', () => {
    const carried = carryParticleWithRest(
        [0, -1, 0], [0, -1, 0], [0, 0, 0], [0, 0, 0],
        [0, 0, 1], [0, -1, 0], false,
    );
    assert.deepEqual(carried.current, [0, -1, 0]);
    assert.deepEqual(carried.previous, [0, -1, 0]);
});

test('braid rest tail follows root translation without following its rotation', () => {
    const rest = preserveHairRestTail([0, 0, 1], [2, 3, 4], [1, 3, 4], [0, -1, 0], true);
    assert.deepEqual(rest, [1, -1, 0]);
});

test('the shared generated table contains reusable follow and spring data', () => {
    assert.ok(selectQuartzDrivers(table).length > 0);
    assert.ok(table.springs.length > 0);
    assert.ok(table.colliders.length > 0);
});
