import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Color } from '../vendor/three/build/three.module.js';
import { GAKUMAS_LOOK, GakumasLookPass, applyGakumasLookUniforms, createGakumasLookUniformValues } from '../gakumas-look.js';

test('gakumas look keeps fill in shadows instead of crushing them to black', () => {
    assert.equal(GAKUMAS_LOOK.key, 0.9);
    assert.equal(GAKUMAS_LOOK.keyColor, '#ffffff');
    assert.equal(GAKUMAS_LOOK.hemi, 0);
    assert.ok(GAKUMAS_LOOK.shadow < 1);
    assert.ok(GAKUMAS_LOOK.shadowFloor > 0.05);
    assert.ok(GAKUMAS_LOOK.lightTermOffset > 0);
    assert.deepEqual(GAKUMAS_LOOK.shadeMultiply, [1, 1, 1]);
    assert.equal(GAKUMAS_LOOK.contrast, 1);
    assert.ok(GAKUMAS_LOOK.skinSaturation > 1);
});

test('look pass encodes linear actor lighting back to sRGB and does not crush shadow luma', () => {
    const source = readFileSync(new URL('../gakumas-look.js', import.meta.url), 'utf8');
    assert.match(source, /linearToOutputTexel/);
    assert.match(source, /SRGBColorSpace/);
    assert.doesNotMatch(source, /mappedLuma/);
    assert.doesNotMatch(source, /LinearSRGBColorSpace/);
});

test('bloom defaults match the selected look and can retune intensity, knee and radius', () => {
    assert.equal(GAKUMAS_LOOK.bloom, 0.2);
    assert.equal(GAKUMAS_LOOK.bloomKnee, 0.72);
    assert.equal(GAKUMAS_LOOK.bloomRadius, 1);
    const pass = new GakumasLookPass({ getPixelRatio: () => 1, getSize() {} });
    const bloom = pass.setBloom({ intensity: 0.2, knee: 0.4, radius: 3 });
    assert.equal(bloom.intensity, 0.2);
    assert.equal(bloom.knee, 0.4);
    assert.equal(bloom.radius, 3);
    assert.equal(pass.material.uniforms.gkLookBloom.value, 0.2);
    assert.equal(pass.material.uniforms.gkLookKnee.value, 0.4);
    assert.equal(pass.material.uniforms.gkLookRadius.value, 3);
    pass.dispose();
});

test('look uniforms write terminator offset, skin saturation and env spec colors', () => {
    const uniforms = createGakumasLookUniformValues();
    assert.equal(uniforms.gkLightTermOffset.value, GAKUMAS_LOOK.lightTermOffset);
    assert.equal(uniforms.gkSkinSaturation.value, GAKUMAS_LOOK.skinSaturation);
    assert.ok(uniforms.gkShadeMultiply.value instanceof Color);
    applyGakumasLookUniforms(uniforms, { ...GAKUMAS_LOOK, skinSaturation: 1.5, specStrength: 0.2 });
    assert.deepEqual(uniforms.gkShadeMultiply.value.toArray(), [1, 1, 1]);
    assert.deepEqual(uniforms.gkSpecSky.value.toArray(), GAKUMAS_LOOK.specSky);
    assert.deepEqual(uniforms.gkSpecFloor.value.toArray(), GAKUMAS_LOOK.specFloor);
    assert.deepEqual(uniforms.gkSpecHorizon.value.toArray(), GAKUMAS_LOOK.specHorizon);
    assert.equal(uniforms.gkSkinSaturation.value, 1.5);
    assert.equal(uniforms.gkSpecStrength.value, 0.2);
});
