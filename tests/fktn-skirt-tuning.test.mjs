import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SecondaryMotion, selectQuartzDrivers, recoveredSkirtDriverQuaternion, recoveredHairDriverQuaternion, recoveredHairLocalOffset, connectionAxisPermute, skirtReferenceQuaternion, eulerDegreesToQuaternionXYZ, quaternionToEulerDegreesXYZ } from '../gakumas-secondary-motion.js';

function rotationAngle(quaternion) {
    return 2 * Math.acos(Math.min(1, Math.abs(quaternion[3]))) * 180 / Math.PI;
}

function multiply(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}

test('Kotone skirt follows thigh flexion with the captured signed coefficients', () => {
    const profile = JSON.parse(readFileSync(new URL('../secondary-motion-profiles/fktn.json', import.meta.url), 'utf8'));
    assert.equal(profile.physicsAlgorithm, 'gakumas-runtime-recovered-v1');
    assert.equal(profile.useModelingRestPose, true);
    const jacketSprings = profile.springs.filter(spring => /Jacket/.test(spring.bone));
    assert.equal(jacketSprings.length, 40);
    assert.ok(jacketSprings.every(spring => spring.modelingLocalTx?.translation && spring.modelingWorldPosition));
    assert.notEqual(profile.disableSkirtMotion, true);
    const drivers = profile.drivers.filter(driver => /Skirt/.test(driver.bone));
    assert.equal(drivers.length, 8);
    const left = drivers.find(item => item.bone === 'LeftFrontSkirt_A').setting;
    const right = drivers.find(item => item.bone === 'RightFrontSkirt_A').setting;
    assert.deepEqual(left.outerCoefficient, [1, -1, -1]);
    assert.deepEqual(right.outerCoefficient, [1, 1, -1]);
    assert.deepEqual(left.limitMin, [-180, -40, -5]);
    assert.deepEqual(right.limitMax, [180, 40, 180]);
    const selectedDrivers = selectQuartzDrivers(profile);
    assert.equal(selectedDrivers.filter(driver => /Skirt/.test(driver.bone)).length, 8);
    assert.ok(selectedDrivers.some(driver => /BackSkirt/.test(driver.bone)));
    assert.equal(profile.springs.filter(spring => /Skirt/.test(spring.bone)).length, 24);
    const legColliders = profile.colliders.filter(item => (item.bone === 'LeftLeg' || item.bone === 'RightLeg') && item.collisionMask === 64);
    assert.equal(legColliders.length, 2);
    assert.ok(legColliders.every(item => item.nativePair?.[0] > 0 && item.nativePair?.[1] > 0));
    const flexed = recoveredSkirtDriverQuaternion(eulerDegreesToQuaternionXYZ([-20, 0, 0]), left);
    const flexedEuler = quaternionToEulerDegreesXYZ(flexed);
    assert.ok(Math.abs(rotationAngle(flexed) - 15.3601) < 1e-3);
    assert.ok(flexedEuler[0] < -10, 'a bow must pitch the skirt around X');
    assert.ok(Math.abs(flexedEuler[1]) < 1 && Math.abs(flexedEuler[2]) < 1, 'a bow must not roll the skirt sideways');
    const twist = recoveredSkirtDriverQuaternion(eulerDegreesToQuaternionXYZ([0, 40, 0]), left);
    assert.ok(rotationAngle(twist) < 1e-4);
});

test('recovered hair calc keeps composeType 0 and the translate channel', () => {
    const profile = JSON.parse(readFileSync(new URL('../secondary-motion-profiles/fktn.json', import.meta.url), 'utf8'));
    const setting = profile.drivers.find(item => item.bone === 'LeftSideHair_A').setting;
    assert.equal(setting.composeType, 0);
    assert.equal(setting.rotateConnectionAxis, 0);
    assert.equal(setting.translateConnectionAxis, 3);
    assert.deepEqual(connectionAxisPermute(1, 2, 3, 0), [1, 2, 3]);
    assert.deepEqual(connectionAxisPermute(1, 2, 3, 3), [2, 3, 1]);
    const nodded = recoveredHairDriverQuaternion(eulerDegreesToQuaternionXYZ([20, 0, 0]), [0, 0, 0, 1], setting);
    const euler = quaternionToEulerDegreesXYZ(nodded);
    assert.ok(Math.hypot(euler[0], euler[1], euler[2]) > 8, 'a head nod still rotates the braid root');
    const rolled = recoveredHairDriverQuaternion(eulerDegreesToQuaternionXYZ([0, 0, 20]), [0, 0, 0, 1], setting);
    assert.ok(rolled.some((value, index) => Math.abs(value - nodded[index]) > 1e-3), 'a head roll is a different swing from a nod');
    const restOffset = recoveredHairLocalOffset([0, 0, 0, 1], setting);
    assert.ok(Math.hypot(...restOffset) < 1e-6, 'a resting head does not shift the braid');
    const nodOffset = recoveredHairLocalOffset(eulerDegreesToQuaternionXYZ([20, 0, 0]), setting);
    const rotateAsPosition = recoveredHairLocalOffset(eulerDegreesToQuaternionXYZ([20, 0, 0]), {
        ...setting,
        headTranslateCoefficient: setting.headRotateCoefficient,
    });
    assert.ok(Math.hypot(...nodOffset) > 1e-4, 'the translate channel moves with the head');
    assert.ok(Math.hypot(...nodOffset) < Math.hypot(...rotateAsPosition) * 0.2, 'position uses the translate coefficients, not the rotate coefficients');
});

test('recovered skirt binding uses the thigh delta, not the bind pose', () => {
    const profile = JSON.parse(readFileSync(new URL('../secondary-motion-profiles/fktn.json', import.meta.url), 'utf8'));
    const driver = profile.drivers.find(item => item.bone === 'LeftFrontSkirt_A');
    const rest = eulerDegreesToQuaternionXYZ([30, -12, 8]);
    const delta = eulerDegreesToQuaternionXYZ([-20, 0, 0]);
    const live = multiply(rest, delta);
    const upLeg = {
        name: 'LeftUpLeg',
        quaternion: { toArray: () => [...live], set() {} },
        updateMatrixWorld() {},
    };
    const skirtValue = [0, 0, 0, 1];
    const skirt = {
        name: 'LeftFrontSkirt_A',
        quaternion: {
            toArray: () => [...skirtValue],
            set(x, y, z, w) { skirtValue.splice(0, 4, x, y, z, w); },
        },
        updateMatrixWorld() {},
    };
    const motion = new SecondaryMotion({
        physicsAlgorithm: profile.physicsAlgorithm,
        drivers: [driver],
        springs: [],
        colliders: [],
        chains: [],
    });
    motion.bind([
        { bone: upLeg, quaternion: { toArray: () => [...rest] } },
        { bone: skirt, quaternion: { toArray: () => [0, 0, 0, 1] } },
    ]);
    motion.update();
    const expected = recoveredSkirtDriverQuaternion(skirtReferenceQuaternion(rest, live), driver.setting);
    const got = skirt.quaternion.toArray();
    for (let index = 0; index < 4; index += 1) assert.ok(Math.abs(got[index] - expected[index]) < 1e-4);
});
