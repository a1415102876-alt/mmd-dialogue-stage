import test from 'node:test';
import assert from 'node:assert/strict';
import { injectActorShader } from '../gakumas-shader.js';

function compileActorShader() {
    const shader = {
        uniforms: {},
        vertexShader: '#include <begin_vertex>\n#include <worldpos_vertex>',
        fragmentShader: '#include <shadowmap_pars_fragment>\nvoid main() {\n#include <lights_fragment_end>\n}',
    };
    injectActorShader(shader, { gkDebugView: { value: 0 } });
    return shader;
}

test('MatCap basis matches the sample: world axes, Unity cross order, light in the same space', () => {
    const { fragmentShader } = compileActorShader();
    assert.match(fragmentShader, /viewMatrix\[0\]\[1\], viewMatrix\[1\]\[1\], viewMatrix\[2\]\[1\]/);
    assert.match(fragmentShader, /cross\(gkViewWS, gkCameraUp\)/);
    assert.match(fragmentShader, /cross\(gkViewSide, gkViewWS\)/);
    assert.match(fragmentShader, /dot\(gkLightWS, gkViewSide\)/);
    assert.doesNotMatch(fragmentShader, /cross\(gkUp, gkView\)/);
});

test('character shadow samples the depth map directly and keeps the contrast curve', () => {
    const shader = compileActorShader();
    assert.match(shader.vertexShader, /gkCharacterShadowCoord = gkCharacterShadowMatrix \* gkWorldPosition/);
    assert.doesNotMatch(shader.vertexShader, /gkCharacterShadowNormalBias/);
    assert.doesNotMatch(shader.fragmentShader, /for \(int gkShadowY = -1; gkShadowY <= 1; gkShadowY \+\+\)/);
    assert.match(shader.fragmentShader, /unpackRGBAToDepth\(texture2D\(gkCharacterShadowMap, gkShadowProj\.xy\)\)/);
    assert.match(shader.fragmentShader, /gkCharacterShadowContact/);
    assert.match(shader.fragmentShader, /4\.0 \* gkShadow - 6\.0/);
    assert.match(shader.fragmentShader, /gkCharacterShadowReceive > 0\.5/);
    assert.doesNotMatch(shader.fragmentShader, /gkHairShadow/);
    assert.doesNotMatch(shader.fragmentShader, /gkDebugView == 8/);
});

test('gakumas look darkens the terminator, saturates skin, and adds env spec plus rampAdd spec multiply', () => {
    const { vertexShader, fragmentShader } = compileActorShader();
    assert.match(vertexShader, /gkRimMask = gkVertexHigh\.w \/ 15\.0/);
    assert.match(fragmentShader, /reflectedLight\.indirectDiffuse = vec3\(0\.0\)/);
    assert.match(fragmentShader, /gkSkinSaturation/);
    assert.match(fragmentShader, /gkSpecSky/);
    assert.match(fragmentShader, /mix\(reflectedLight\.directSpecular, reflectedLight\.directSpecular \* gkRampAddTint, gkRampAddSample\.a\)/);
    assert.match(fragmentShader, /pow\(max\(1\.0 - dot\(normalize\(normal\), gkRimDir\), 0\.0\), max\(gkRimPower, 0\.0\)\)/);
    assert.match(fragmentShader, /min\(gkRim, 1\.0\) \* min\(gkDef\.r \* gkDef\.r, 1\.0\) \* gkRimMask/);
    assert.match(fragmentShader, /mix\(vec3\(1\.0\), gkActorColor, clamp\(gkRimAlbedo, 0\.0, 1\.0\)\)/);
    assert.doesNotMatch(fragmentShader, /pow\(1\.0 - max\(gkMatNormal\.z, 0\.0\), 8\.0\)/);
    assert.match(fragmentShader, /gkLighting = max\(gkLighting, gkShadowFloor\)/);
      assert.match(fragmentShader, /mix\(gkBase, gkShadeTint, gkRamp\.a\)/);
      assert.match(fragmentShader, /gkShadowForLighting = mix\(1\.0, gkShadow, clamp\(gkShadowStrength/);
      assert.match(fragmentShader, /gkSkin = gkBase \* gkSkinRamp/);
    assert.doesNotMatch(fragmentShader, /pow\(1\.0 - max\(gkMatNormal\.z, 0\.0\), 2\.8\)/);
});

test('vertex shadow bias does not depend on Three.js worldPosition being declared', () => {
    const { vertexShader } = compileActorShader();
    assert.match(vertexShader, /vec4 gkWorldPosition = vec4\(transformed, 1\.0\)/);
    assert.match(vertexShader, /gkWorldPosition = modelMatrix \* gkWorldPosition/);
    assert.match(vertexShader, /gkCharacterShadowCoord = gkCharacterShadowMatrix \* gkWorldPosition/);
    assert.doesNotMatch(vertexShader, /gkShadowBiased = worldPosition\.xyz \+/);
});
