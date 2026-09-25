import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { identifyLibraryIdol, supportsSecondaryMotion, motionMatchesIdol } from '../idol-library.js';

const config = JSON.parse(readFileSync(new URL('../library.json', import.meta.url)));

test('exported idols have unique models, packs and truthful outfit labels', () => {
    assert.equal(config.idols.length, 13);
    assert.equal(new Set(config.idols.map(idol => idol.id)).size, 13);
    for (const idol of config.idols) {
        assert.ok(config.packs[idol.pack]?.root);
        assert.equal(identifyLibraryIdol(config, idol.model)?.id, idol.id);
        assert.equal(identifyLibraryIdol(config, idol.model.replace(/-vmd(?:-face)?\.pmx$/, '.pmx'))?.id, idol.id);
        assert.equal(supportsSecondaryMotion(idol), true);
        if (idol.id !== 'fktn' && idol.id !== 'amao' && idol.id !== 'ttmr' && idol.id !== 'kcna' && idol.id !== 'shro') assert.equal(idol.outfit, 'SCHL-0000');
        if (idol.id !== 'fktn') assert.equal(idol.visemes, undefined);
    }
});

test('other idols see common and their own motions, never Kotone-only fallback', () => {
    assert.equal(motionMatchesIdol({ character: 'fktn' }, 'ttmr'), false);
    assert.equal(motionMatchesIdol({ catalog: { character: 'cmmn' } }, 'ttmr'), true);
    assert.equal(motionMatchesIdol({ character: 'ttmr' }, 'ttmr'), true);
    assert.equal(identifyLibraryIdol(config, 'unknown.pmx'), null);
    assert.equal(supportsSecondaryMotion(null), false);
    assert.equal(supportsSecondaryMotion({ id: 'ttmr', secondaryMotionProfile: false }), false);
});
