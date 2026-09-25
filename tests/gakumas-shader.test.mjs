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

test('character shadow uses Unity-like caster bias, PCF and the sample contrast curve', () => {
    const shader = compileActorShader();
    assert.match(shader.vertexShader, /gkCharacterShadowLightDir \* gkCharacterShadowConstantBias/);
    assert.match(shader.vertexShader, /\(1\.0 - gkShadowNdotL\) \* gkCharacterShadowNormalBias/);
    assert.match(shader.fragmentShader, /for \(int gkShadowY = -1; gkShadowY <= 1; gkShadowY \+\+\)/);
    assert.match(shader.fragmentShader, /gkCharacterShadowContact/);
    assert.match(shader.fragmentShader, /4\.0 \* gkCharacterShadow - 6\.0/);
    assert.match(shader.fragmentShader, /gkCharacterShadowReceive > 0\.5/);
    assert.doesNotMatch(shader.fragmentShader, /step\(gkShadowProj\.z - 0\.0015/);
});

test('screen-space bangs shadow offsets toward the light and rejects farther hair', () => {
    const { fragmentShader } = compileActorShader();
    assert.match(fragmentShader, /gkHairScreen = gl_FragCoord\.xy \/ max\(gkHairShadowResolution, vec2\(1\.0\)\)/);
    assert.doesNotMatch(fragmentShader, /gkHairScreen\.y = 1\.0 - gkHairScreen\.y/);
    assert.doesNotMatch(fragmentShader, /gkHairShift\.y = -gkHairShift\.y/);
    assert.match(fragmentShader, /gkHairShadowLightVS\.xy \* \(\(gkHairShadowOffset \* gkHairShadowFocus\) \/ gkHairViewZ\)/);
    assert.match(fragmentShader, /gkHairOccluderZ = -perspectiveDepthToViewZ\(gkHairDepth, gkHairShadowNear, gkHairShadowFar\)/);
    assert.match(fragmentShader, /gkHairSample\.a > 0\.5 && gkHairOccluderZ \+ gkHairShadowBias < gkHairViewZ/);
    assert.doesNotMatch(fragmentShader, /gkHairDepth \+ gkHairShadowBias < gl_FragCoord\.z/);
    assert.doesNotMatch(fragmentShader, /gkHairDepth < 0\.999/);
    assert.match(fragmentShader, /gkDebugView == 8/);
});

test('gakumas look darkens the terminator, saturates skin, and adds env spec plus rampAdd spec multiply', () => {
    const { vertexShader, fragmentShader } = compileActorShader();
    assert.match(vertexShader, /gkRimMask = gkVertexHigh\.w \/ 15\.0/);
    assert.match(fragmentShader, /reflectedLight\.indirectDiffuse = vec3\(0\.0\)/);
    assert.match(fragmentShader, /gkSkinSaturation/);
    assert.match(fragmentShader, /gkSpecSky/);
    assert.match(fragmentShader, /mix\(reflectedLight\.directSpecular, reflectedLight\.directSpecular \* gkRampAddTint, gkRampAddSample\.a\)/);
    assert.match(fragmentShader, /pow\(1\.0 - max\(gkMatNormal\.z, 0\.0\), 8\.0\)/);
    assert.match(fragmentShader, /min\(gkDef\.r \* gkDef\.r, 1\.0\) \* gkRimMask/);
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
    assert.match(vertexShader, /gkShadowBiased = gkWorldPosition\.xyz \+/);
    assert.doesNotMatch(vertexShader, /gkShadowBiased = worldPosition\.xyz \+/);
});
