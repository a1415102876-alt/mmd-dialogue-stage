import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRegions, groupMethods, groupManifestFiles, excludeCodeOverlap, formatDecompTargets } from '../tools/prepare-offline-evidence.mjs';

test('decompiler targets canonicalize prefixed, padded and mixed-case aliases', () => {
    const methods = groupManifestFiles([
        'A\tN\tSkirt\tCalc\tvoid()\t0000ABCD\t2\tskirt.bin',
        'runtime-native\tNative\tCallTarget\tTarget_ABCD\tvoid()\t0xabcd\t4\thelper.bin',
    ]);
    assert.equal(formatDecompTargets(methods), '0xabcd\tSkirt_Calc\n');
});

test('identical code/data overlaps are removed, conflicting overlaps fail', () => {
    const code = [{ address: 10, bytes: Buffer.from([1, 2]) }];
    assert.deepEqual(excludeCodeOverlap([{ address: 9, bytes: Buffer.from([9, 1, 2, 3]) }], code)
        .map(region => [region.address, [...region.bytes]]), [[9, [9]], [12, [3]]]);
    assert.throws(() => excludeCodeOverlap([{ address: 10, bytes: Buffer.from([5]) }], code), /Conflicting code\/data/);
});

test('merges overlapping code without duplicating shared functions', () => {
    const result = mergeRegions([{ address: 4096, bytes: Buffer.from([1, 2]) }, { address: 4097, bytes: Buffer.from([2, 3]) }]);
    assert.deepEqual(result.regions.map(item => [item.address, [...item.bytes]]), [[4096, [1, 2, 3]]]);
    assert.deepEqual(result.conflicts, []);
});

test('conflicting dynamic bytes remain unknown, not first-wins constants', () => {
    const result = mergeRegions([{ address: 4096, bytes: Buffer.from([1, 2, 3]) }, { address: 4097, bytes: Buffer.from([9]) }]);
    assert.deepEqual(result.conflicts, [4097]);
    assert.deepEqual(result.regions.map(item => [item.address, [...item.bytes]]), [[4096, [1]], [4098, [3]]]);
});

test('shared entry keeps all aliases and rejects invalid addresses', () => {
    const methods = groupMethods('A\tN\tSkirt\tExecute\tvoid()\t00001000\t2\tskirt.bin\nA\tN\tHair\tExecute\tvoid()\t00001000\t2\thair.bin');
    assert.equal(methods.length, 1);
    assert.equal(methods[0].aliases.length, 2);
    assert.throws(() => groupMethods('A\tN\tC\tM\tvoid()\tgarbage\t2\tx.bin'));
});

test('combines the primary and helper manifests without duplicating addresses', () => {
    const methods = groupManifestFiles([
        'A\tN\tSkirt\tCalc\tvoid()\t00001000\t2\tskirt.bin',
        'runtime-helper\tNative\tCallTarget\tTarget_1000\tvoid()\t00001000\t4\thelper.bin',
        'runtime-helper\tNative\tCallTarget\tTarget_2000\tvoid()\t00002000\t4\thelper2.bin',
    ]);
    assert.equal(methods.length, 2);
    assert.equal(methods.find(item => item.address === 0x1000).aliases.length, 2);
});
