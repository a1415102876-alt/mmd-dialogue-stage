import test from 'node:test';
import assert from 'node:assert/strict';
import { actorStencilState, classifyActorPass, isHairCoverSourceMaterial, shouldCastCharacterShadow, shouldReceiveCharacterShadow, shouldReceiveHairShadow, shouldWriteHairShadow } from '../gakumas-passes.js';

test('classifies actor materials without including highlights in HairCover', () => {
    assert.equal(classifyActorPass('m_bdy', ''), 'body');
    assert.equal(classifyActorPass('m_fce', ''), 'face');
    assert.equal(classifyActorPass('m_eye', ''), 'eye');
    assert.equal(classifyActorPass('m_ehl', ''), 'eye');
    assert.equal(classifyActorPass('m_hir', ''), 'hair');
    assert.equal(classifyActorPass('m_hir+', ''), 'hairHighlight');
    assert.equal(classifyActorPass('', 't_chr_fktn-base-0000_hir_sph.png'), 'hairHighlight');
});

test('character shadow only allows separately authored clothing to cast', () => {
    for (const role of ['face', 'faceDetail', 'eye', 'hairHighlight', 'hairCover', 'internal', 'body', 'hair']) assert.equal(shouldCastCharacterShadow(role), false);
    assert.equal(shouldCastCharacterShadow('clothing'), true);
});

test('screen-space hair shadow is written by hair and received by face and eyes', () => {
    assert.equal(shouldWriteHairShadow('hair'), true);
    for (const role of ['hairHighlight', 'face', 'eye', 'body', 'clothing']) assert.equal(shouldWriteHairShadow(role), false);
    for (const role of ['face', 'faceDetail', 'eye']) assert.equal(shouldReceiveHairShadow(role), true);
    for (const role of ['hair', 'hairHighlight', 'body', 'clothing', 'internal']) assert.equal(shouldReceiveHairShadow(role), false);
});

test('only body and clothing receive character shadow; hair and face do not', () => {
    for (const role of ['hair', 'hairHighlight', 'hairCover', 'eye', 'internal', 'face', 'faceDetail']) assert.equal(shouldReceiveCharacterShadow(role), false);
    for (const role of ['body', 'clothing']) assert.equal(shouldReceiveCharacterShadow(role), true);
});

test('m_hir and its base texture must both match to enable the extra pass', () => {
    assert.equal(isHairCoverSourceMaterial('m_hir', 't_chr_fktn-base-0000_hir_col_alp.png'), true);
    assert.equal(isHairCoverSourceMaterial('m_hir', 't_chr_fktn-casl-0000_bdy_col.png'), false);
    assert.equal(isHairCoverSourceMaterial('m_hir+', 't_chr_fktn-base-0000_hir_sph.png'), false);
    assert.equal(isHairCoverSourceMaterial('m_hirco', 't_chr_fktn-base-0000_hirco_col_alp.png'), false);
    assert.equal(isHairCoverSourceMaterial('m_bdy', 't_chr_fktn-base-0000_hir_col_alp.png'), false);
});

test('preserves the already working base hair and eye stencil states', () => {
    assert.deepEqual(actorStencilState('m_hir', 'hair'), {
        write: true, func: 'GreaterEqualStencilFunc', ref: 64, readMask: 108, writeMask: 96,
        fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'ReplaceStencilOp',
    });
    assert.deepEqual(actorStencilState('m_eye', 'eye'), {
        write: true, func: 'EqualStencilFunc', ref: 68, readMask: 108, writeMask: 108,
        fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'KeepStencilOp',
    });
    assert.equal(actorStencilState('m_ebs', 'faceDetail').ref, 68);
    assert.equal(actorStencilState('m_fcp', 'faceDetail').ref, 72);
});
