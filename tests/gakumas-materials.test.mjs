import test from 'node:test';
import assert from 'node:assert/strict';
import { textureDescriptor, describeMaterial, selectMaterialTextures, textureUsesColorSpace, setTextureColorSpace } from '../gakumas-materials.js';
import { Texture, SRGBColorSpace } from '../vendor/three/build/three.module.js';
import { injectActorShader } from '../gakumas-shader.js';

const materialFor = name => ({ name: '合并模型材质', userData: { MMD: { mapFileName: `Texture2D\\${name}` } } });
const entries = [
    't_chr_fktn-base-0000_eye_sdw.png', 't_chr_fktn-base-0000_eye_def.png',
    't_chr_fktn-base-0000_fce_sdw.png', 't_chr_fktn-base-0000_fce_def.png', 't_chr_fktn-base-0000_fce_lyr.png',
    't_chr_fktn-base-0000_hir_sdw.png', 't_chr_fktn-base-0000_hir_def.png',
    't_chr_fktn-base-0000_hir_hhl.png', 't_chr_fktn-base-0000_hir_rma.png',
    't_chr_fktn-base-0000_hirco_sdw.png', 't_chr_fktn-base-0000_rmp.png',
    't_chr_fktn-casl-0000_bdy_sdw.png', 't_chr_fktn-casl-0000_bdy_def.png', 't_chr_fktn-casl-0000_bdy_rma.png',
    't_chr_ssmk-base-0000_rmp.png', 't_chr_fktn-base-0000_ehl_col.png',
].map(textureDescriptor);

test('recognizes original texture suffixes, Windows paths and alpha base maps', () => {
    const descriptor = textureDescriptor('Texture2D\\T_CHR_FKTN-BASE-0000_HIR_COL_ALP.PNG');
    assert.equal(descriptor.stem, 't_chr_fktn-base-0000_hir');
    assert.equal(descriptor.character, 'fktn');
    assert.equal(descriptor.role, 'hair');
    assert.equal(descriptor.kind, 'base');
    for (const [suffix, kind] of [['rmp', 'ramp'], ['hhl', 'highlight'], ['rma', 'rampAdd'], ['lyr', 'layer']]) {
        assert.equal(textureDescriptor(`t_chr_fktn-base-0000_hir_${suffix}.png`).kind, kind);
    }
});

test('selects textures per material even when all material names are identical', () => {
    for (const [part, role] of [['bdy', 'body'], ['fce', 'face'], ['hir', 'hair'], ['eye', 'eye']]) {
        const prefix = `t_chr_fktn-${part === 'bdy' ? 'casl' : 'base'}-0000_${part}`;
        const selection = selectMaterialTextures(materialFor(`${prefix}_col.png`), entries);
        assert.equal(selection.descriptor.role, role);
        assert.equal(selection.bindings.shade.name, `${prefix}_sdw.png`);
        assert.equal(selection.bindings.def.name, `${prefix}_def.png`);
        assert.equal(selection.bindings.ramp.name, 't_chr_fktn-base-0000_rmp.png');
    }
});

test('does not borrow eye highlights, hair maps or maps from other characters', () => {
    const face = selectMaterialTextures(materialFor('t_chr_fktn-base-0000_fce_col.png'), entries);
    const hair = selectMaterialTextures(materialFor('t_chr_fktn-base-0000_hir_col_alp.png'), entries);
    const accessory = selectMaterialTextures(materialFor('t_chr_fktn-base-0000_hirco_col_alp.png'), entries);
    assert.equal(face.bindings.highlight, undefined);
    assert.equal(hair.bindings.highlight.name, 't_chr_fktn-base-0000_hir_hhl.png');
    assert.equal(accessory.descriptor.role, 'hairAccessory');
    assert.equal(accessory.bindings.def, undefined);
    assert.deepEqual(selectMaterialTextures(materialFor('t_chr_other-base-0000_fce_col.png'), entries).bindings, {});
    assert.equal(describeMaterial(materialFor('t_chr_fktn-base-0000_ehl_col.png')).role, 'eyeHighlight');
});

test('ambiguous files are reported instead of depending on file order', () => {
    const source = materialFor('t_chr_fktn-base-0000_fce_col.png');
    const duplicate = entries.find(entry => entry.name.endsWith('fce_def.png'));
    const selection = selectMaterialTextures(source, [...entries, { ...duplicate }]);
    assert.equal(selection.bindings.def, undefined);
    assert.deepEqual(selection.ambiguous, ['def']);
    assert.deepEqual(selectMaterialTextures(source, entries), selectMaterialTextures(source, [...entries].reverse()));
});

test('changing an uploaded base texture to sRGB schedules exactly one reupload', () => {
    const texture = new Texture();
    const version = texture.version;
    setTextureColorSpace(texture, SRGBColorSpace);
    assert.equal(texture.colorSpace, SRGBColorSpace);
    assert.equal(texture.version, version + 1);
    setTextureColorSpace(texture, SRGBColorSpace);
    assert.equal(texture.version, version + 1);
});

test('all Def maps are data textures, including face and eye maps', () => {
    for (const entry of entries.filter(entry => entry.kind === 'def')) assert.equal(textureUsesColorSpace(entry.kind), false);
    assert.equal(textureUsesColorSpace('anisotropic'), false);
    assert.equal(textureUsesColorSpace('ramp'), true);
    assert.equal(textureUsesColorSpace('shade'), true);
});

test('shader preserves MMD source and installs one actor lighting replacement', () => {
    const source = '#include <shadowmap_pars_fragment>\nvoid main() {\n#include <lights_fragment_end>\n}';
    const shader = { uniforms: {}, fragmentShader: source };
    const uniforms = { gkDebugView: { value: 0 } };
    injectActorShader(shader, uniforms);
    assert.equal(shader.uniforms.gkDebugView, uniforms.gkDebugView);
    assert.equal(shader.fragmentShader.match(/#include <lights_fragment_end>/g).length, 1);
    assert.match(shader.fragmentShader, /#include <shadowmask_pars_fragment>/);
    assert.match(shader.fragmentShader, /gkDef.r \* 2.0 - 1.0/);
    assert.match(shader.fragmentShader, /gkSkinMask = gkShade.a/);
    assert.match(shader.fragmentShader, /reflect\(gkNormalWS, normalize\(gkHeadRight\)\)/);
    assert.doesNotMatch(shader.fragmentShader, /gkBand|gkAniso/);
});
