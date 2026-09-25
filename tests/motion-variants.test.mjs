import test from 'node:test';
import assert from 'node:assert/strict';
import { findGesturePlaylistIndex } from '../core.js';
import { DEFAULT_MOTION_VARIANTS, selectPortraitPerformance } from '../portrait-cues.js';

const confirmed = { fktn: 'b', hmsz: 'd', ttmr: 'c', jsna: 'c', atbm: 'c', amao: 'c', hski: 'a', hume: 'b', kcna: 'b', kllj: 'd', hrnm: 'd' };
const item = (variant, character = 'cmmn') => ({ family: 'yes', character, variant, phase: 'in', pairing: 'paired', body: `yes-${character}-${variant}-b`, face: `yes-${character}-${variant}-f` });

test('all confirmed idols use their type through both automatic selectors', () => {
    assert.deepEqual(DEFAULT_MOTION_VARIANTS, confirmed);
    const catalog = ['a', 'b', 'c', 'd'].map(variant => item(variant));
    for (const [idol, variant] of Object.entries(confirmed)) {
        assert.equal(catalog[findGesturePlaylistIndex(catalog, 'yes', idol, { random: () => 0 })].variant, variant);
        assert.equal(selectPortraitPerformance({ mode: 'paired', gesture: 'yes' }, catalog, idol).variant, variant);
    }
    assert.equal(DEFAULT_MOTION_VARIANTS.ssmk, undefined);
    assert.equal(DEFAULT_MOTION_VARIANTS.shro, undefined);
});

test('shared types are compatible and exact types win', () => {
    const catalog = [item('a'), item('ac'), item('bd')];
    assert.equal(findGesturePlaylistIndex(catalog, 'yes', 'ttmr'), 1);
    assert.equal(findGesturePlaylistIndex(catalog, 'yes', 'hume'), 2);
    catalog.push(item('c'));
    assert.equal(findGesturePlaylistIndex(catalog, 'yes', 'ttmr'), 3);
});

test('dedicated and untyped motions win while missing types retain the existing fallback', () => {
    const catalog = [item('a'), item('c'), item('', 'ttmr')];
    assert.equal(findGesturePlaylistIndex(catalog, 'yes', 'ttmr'), 2);
    assert.equal(findGesturePlaylistIndex([item('a'), item('')], 'yes', 'ttmr'), 1);
    assert.equal(findGesturePlaylistIndex([item('a')], 'yes', 'ttmr'), 0);
    assert.equal(findGesturePlaylistIndex([item('a')], 'yes', 'shro'), 0);
});
