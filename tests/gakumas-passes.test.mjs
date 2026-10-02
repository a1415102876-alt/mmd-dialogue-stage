import test from 'node:test';
import assert from 'node:assert/strict';
import { actorStencilState, characterShadowFrustum, characterShadowLightOffset, characterShadowViewBasis, classifyActorPass, isHairCoverSourceMaterial, shouldCastCharacterShadow, shouldReceiveCharacterShadow } from '../gakumas-passes.js';

test('classifies actor materials without including highlights in HairCover', () => {
    assert.equal(classifyActorPass('m_bdy', ''), 'body');
    assert.equal(classifyActorPass('m_fce', ''), 'face');
    assert.equal(classifyActorPass('m_eye', ''), 'eye');
    assert.equal(classifyActorPass('m_ehl', ''), 'eye');
    assert.equal(classifyActorPass('m_hir', ''), 'hair');
    assert.equal(classifyActorPass('m_hir+', ''), 'hairHighlight');
    assert.equal(classifyActorPass('', 't_chr_fktn-base-0000_hir_sph.png'), 'hairHighlight');
});

test('character shadow depth includes hair, body and clothing, and omits the face', () => {
    for (const role of ['hair', 'body', 'clothing', 'bodyAccessory']) assert.equal(shouldCastCharacterShadow(role), true);
    for (const role of ['face', 'faceDetail', 'eye', 'hairHighlight', 'hairCover', 'internal']) assert.equal(shouldCastCharacterShadow(role), false);
});

test('face, eyes, hair, body and clothing sample the character shadow', () => {
    for (const role of ['face', 'eye', 'hair', 'body', 'clothing', 'bodyAccessory']) assert.equal(shouldReceiveCharacterShadow(role), true);
    assert.equal(shouldReceiveCharacterShadow('faceDetail'), false);
    for (const role of ['hairHighlight', 'hairCover', 'internal']) assert.equal(shouldReceiveCharacterShadow(role), false);
});

test('character shadow light follows the camera forward instead of the body center', () => {
    const frustum = characterShadowFrustum(8);
    assert.equal(frustum.mapSize, 4096);
    assert.ok(frustum.contact > 0 && frustum.contact < 0.01);
    const placement = characterShadowLightOffset([0, 0, -1], [0, 8, 0], frustum.distance);
    assert.ok(Math.abs(placement.direction[0]) < 1e-6);
    assert.ok(Math.abs(placement.direction[1]) < 1e-6);
    assert.ok(placement.direction[2] < -0.99);
    assert.equal(placement.position[1], 8);
    assert.ok(placement.position[2] > 0);
    const basis = characterShadowViewBasis([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ]);
    assert.ok(basis.forward[2] < -0.99);
    assert.ok(Math.abs(basis.up[1] - 1) < 1e-6);
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
