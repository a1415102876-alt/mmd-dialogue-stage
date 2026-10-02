export function injectActorShader(shader, uniforms) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `
uniform mat4 gkCharacterShadowMatrix;
varying vec4 gkCharacterShadowCoord;
attribute vec4 gakumasVertexColor;
varying float gkRampAddId;
varying float gkRimMask;
${shader.vertexShader}`;
    // worldpos_vertex only declares worldPosition when USE_SHADOWMAP / USE_ENVMAP
    // etc. are set. VN live portrait keeps shadowMap off, so that identifier
    // never exists. Always compute our own clip-independent world position.
    shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vec4 gkWorldPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
gkWorldPosition = batchingMatrix * gkWorldPosition;
#endif
#ifdef USE_INSTANCING
gkWorldPosition = instanceMatrix * gkWorldPosition;
#endif
gkWorldPosition = modelMatrix * gkWorldPosition;
gkCharacterShadowCoord = gkCharacterShadowMatrix * gkWorldPosition;`);
    shader.fragmentShader = `
#undef USE_MATCAP
uniform sampler2D gkShadeMap;
uniform sampler2D gkDefMap;
uniform sampler2D gkRampMap;
uniform sampler2D gkHighlightMap;
uniform sampler2D gkRampAddMap;
uniform float gkHasShade;
uniform float gkHasRamp;
uniform float gkHasHighlight;
uniform float gkHasRampAdd;
uniform vec3 gkRampAddColor;
uniform vec3 gkLightDirection;
uniform vec3 gkLightColor;
uniform float gkLightStrength;
uniform float gkLightTermOffset;
uniform float gkShadowFloor;
uniform float gkShadowStrength;
uniform float gkSkinSaturation;
uniform float gkSkinLift;
uniform vec3 gkShadeMultiply;
uniform vec3 gkSpecSky;
uniform vec3 gkSpecFloor;
uniform vec3 gkSpecHorizon;
uniform float gkSpecStrength;
uniform vec3 gkHeadRight;
uniform vec3 gkRimDirection;
uniform vec3 gkRimColor;
uniform float gkRimStrength;
uniform float gkRimPower;
uniform float gkRimAlbedo;
uniform int gkDebugView;
uniform sampler2D gkCharacterShadowMap;
uniform float gkCharacterShadowEnabled;
uniform float gkCharacterShadowReceive;
uniform float gkCharacterShadowContact;
#ifdef GK_HAIR_COVER_PASS
uniform vec3 gkHairHeadForward;
uniform vec3 gkHairHeadUp;
uniform vec4 gkHairFadeParameters;
uniform float gkHairMinimumCoverage;
#endif
varying vec4 gkCharacterShadowCoord;
varying float gkRampAddId;
varying float gkRimMask;
${shader.fragmentShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 gkVertexHigh = floor(gakumasVertexColor * 15.9375 + 0.03125);
vec4 gkVertexLow = gakumasVertexColor * 255.0 - gkVertexHigh * 16.0;
gkRampAddId = gkVertexLow.y / 15.0;
gkRimMask = gkVertexHigh.w / 15.0;`);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
#ifdef GK_HAIR_COVER_PASS
gl_Position.z -= 0.0015 * gl_Position.w;
#endif`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
#ifdef GK_HAIR_COVER_PASS
float gkHairFadeMask = 0.0;
#ifdef USE_MAP
gkHairFadeMask = texture2D(map, vMapUv).a;
#endif
vec3 gkHairViewWorld = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
float gkHairFadeX = clamp((gkHairFadeParameters.x - dot(gkHairHeadForward, gkHairViewWorld)) * gkHairFadeParameters.y, 0.0, 1.0);
float gkHairFadeZ = clamp((abs(dot(gkHairHeadUp, gkHairViewWorld)) - gkHairFadeParameters.z) * gkHairFadeParameters.w, 0.0, 1.0);
float gkHairFade = max(max(gkHairFadeX, gkHairFadeZ), gkHairMinimumCoverage);
diffuseColor.a = mix(1.0, gkHairFade, gkHairFadeMask) * opacity;
#endif
#ifdef GK_EYE_HIGHLIGHT
// The exported m_ehl image is an RGB glow atlas with an opaque black
// background. Unity's material used the shader mask to discard that black;
// reconstruct the same mask here because the PNG alpha is fully opaque.
float gkEyeHighlightMask = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
diffuseColor.a *= smoothstep(0.015, 0.08, gkEyeHighlightMask);
#endif
#include <alphatest_fragment>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
#include <lights_fragment_end>
vec2 gkUv = vec2(0.5);
#ifdef USE_MAP
gkUv = vMapUv;
#endif
vec3 gkBase = diffuseColor.rgb;
vec4 gkShade = texture2D(gkShadeMap, gkUv);
gkShade = mix(vec4(gkBase, 0.0), gkShade, gkHasShade);
vec4 gkDef = texture2D(gkDefMap, gkUv);
vec3 gkNormalWS = inverseTransformDirection(normalize(normal), viewMatrix);
vec3 gkViewWS = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
vec3 gkCameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 gkViewSide = normalize(cross(gkViewWS, gkCameraUp));
vec3 gkViewUp = normalize(cross(gkViewSide, gkViewWS));
vec3 gkMatNormal = vec3(dot(gkNormalWS, gkViewSide), dot(gkNormalWS, gkViewUp), dot(gkNormalWS, gkViewWS));
vec3 gkLightWS = normalize(gkLightDirection);
vec3 gkLight = vec3(dot(gkLightWS, gkViewSide), dot(gkLightWS, gkViewUp), dot(gkLightWS, gkViewWS));
float gkOffset = gkDef.r * 2.0 - 1.0;
vec4 gkRampAddSample = vec4(0.0);
vec3 gkRampAddTint = vec3(0.0);
if (gkHasRampAdd > 0.5) {
    vec2 gkRampAddUv = vec2(clamp(gkOffset + gkMatNormal.z, 0.0, 1.0), clamp(gkRampAddId, 0.0, 1.0));
    gkRampAddSample = texture2D(gkRampAddMap, gkRampAddUv);
    gkRampAddTint = gkRampAddSample.rgb * gkRampAddColor;
    vec3 gkRampAdd = gkRampAddTint * (1.0 - gkRampAddSample.a);
    gkBase += gkRampAdd;
    gkShade.rgb += gkRampAdd;
}
float gkLighting = clamp(dot(gkMatNormal, gkLight) * 0.5 + 0.5 + (gkOffset - gkLightTermOffset) * 0.5, 0.0, 1.0);
float gkMetallic = gkDef.b;
#ifdef GK_FACE
vec3 gkReflectedWS = reflect(gkNormalWS, normalize(gkHeadRight));
vec3 gkReflectedMat = vec3(dot(gkReflectedWS, gkViewSide), dot(gkReflectedWS, gkViewUp), dot(gkReflectedWS, gkViewWS));
float gkFaceLight = clamp((dot(gkReflectedMat, gkLight) + gkOffset) * 0.5 + 0.5, 0.0, 1.0);
gkLighting = mix(gkLighting, max(gkLighting, gkFaceLight), gkDef.b);
gkMetallic = 0.0;
#endif
float gkShadow = 1.0;
if (gkCharacterShadowEnabled > 0.5 && gkCharacterShadowReceive > 0.5) {
    vec3 gkShadowProj = gkCharacterShadowCoord.xyz / max(gkCharacterShadowCoord.w, 0.0001);
    if (all(greaterThanEqual(gkShadowProj.xy, vec2(0.0))) && all(lessThanEqual(gkShadowProj.xy, vec2(1.0))) && gkShadowProj.z <= 1.0) {
        float gkSampleDepth = unpackRGBAToDepth(texture2D(gkCharacterShadowMap, gkShadowProj.xy));
        gkShadow = (gkShadowProj.z - gkSampleDepth) > gkCharacterShadowContact ? 0.0 : 1.0;
        gkShadow = clamp(gkShadow * ((4.0 * gkShadow - 6.0) * gkShadow + 3.0), 0.0, 1.0);
    }
}
float gkShadowForLighting = mix(1.0, gkShadow, clamp(gkShadowStrength, 0.0, 1.0));
gkLighting = min(gkLighting, gkShadowForLighting);
gkLighting = max(gkLighting, gkShadowFloor);
float gkSpecMask = min(gkDef.a, gkShadowForLighting);
#ifdef GK_HAIR
#ifdef GK_HAIR_COVER_PASS
gkSpecMask = 0.0;
#else
float gkHairProp = step(0.75001, gkUv.x) * step(0.75001, gkUv.y);
float gkHairHighlight = smoothstep(0.35, 0.65, pow(clamp(gkMatNormal.z, 0.0, 1.0), 4.0));
gkHairHighlight *= gkSpecMask * gkHasHighlight * (1.0 - gkHairProp);
gkBase = mix(gkBase, texture2D(gkHighlightMap, gkUv).rgb, gkHairHighlight);
gkSpecMask *= gkHairProp;
#endif
#endif
vec4 gkRamp = texture2D(gkRampMap, vec2(gkLighting, 0.5));
float gkFallbackShade = 1.0 - smoothstep(0.35, 0.65, gkLighting);
gkRamp = mix(vec4(vec3(1.0 - 0.3 * gkFallbackShade), gkFallbackShade), gkRamp, gkHasRamp);
float gkSkinMask = gkShade.a;
#ifdef GK_HAIR
gkSkinMask = 0.0;
#endif
#ifdef GK_EYE
gkSkinMask = 0.0;
#endif
vec3 gkShadeTint = gkShade.rgb * gkShadeMultiply;
vec3 gkSkinRamp = mix(gkRamp.rgb, gkRamp.rgb * gkShadeMultiply, gkRamp.a);
vec3 gkNonSkin = mix(gkBase, gkShadeTint, gkRamp.a);
vec3 gkSkin = gkBase * gkSkinRamp;
gkSkin = min(gkSkin + vec3(gkSkinLift * gkLighting), vec3(1.0));
vec3 gkActorColor = mix(gkNonSkin, gkSkin, gkSkinMask);
float gkSat = mix(1.0, gkSkinSaturation, gkSkinMask);
float gkLum = dot(gkActorColor, vec3(0.2126, 0.7152, 0.0722));
gkActorColor = mix(vec3(gkLum), gkActorColor, gkSat);
reflectedLight.directDiffuse = gkActorColor * gkLightColor * gkLightStrength;
reflectedLight.indirectDiffuse = vec3(0.0);
reflectedLight.directSpecular = vec3(0.0);
reflectedLight.indirectSpecular = vec3(0.0);
totalEmissiveRadiance = vec3(0.0);
vec3 gkHalfVector = gkLight + vec3(0.0, 0.0, 1.0);
vec3 gkHalf = gkHalfVector / max(length(gkHalfVector), 0.0001);
float gkRoughness = max(1.0 - gkDef.g, 0.08);
float gkAlphaSquared = pow(gkRoughness, 4.0);
float gkNoH = max(dot(gkMatNormal, gkHalf), 0.0);
float gkNoL = max(dot(gkMatNormal, gkLight), 0.0);
float gkNoV = max(gkMatNormal.z, 0.001);
float gkDenom = gkNoH * gkNoH * (gkAlphaSquared - 1.0) + 1.0;
float gkDistribution = gkAlphaSquared / max(3.14159265 * gkDenom * gkDenom, 0.00001);
float gkVisibilityFactor = pow(gkRoughness + 1.0, 2.0) / 8.0;
float gkVisibility = gkNoV / (gkNoV * (1.0 - gkVisibilityFactor) + gkVisibilityFactor);
gkVisibility *= gkNoL / max(gkNoL * (1.0 - gkVisibilityFactor) + gkVisibilityFactor, 0.001);
vec3 gkFresnelBase = mix(vec3(0.04), gkBase, gkMetallic);
vec3 gkFresnel = gkFresnelBase + (1.0 - gkFresnelBase) * pow(1.0 - max(gkHalf.z, 0.0), 5.0);
reflectedLight.directSpecular = gkFresnel * gkDistribution * gkVisibility / (4.0 * gkNoV) * gkSpecMask * gkLightColor * gkLightStrength;
vec3 gkReflectWS = reflect(-gkViewWS, gkNormalWS);
float gkEnvY = clamp(gkReflectWS.y * 0.5 + 0.5, 0.0, 1.0);
vec3 gkEnv = mix(gkSpecFloor, gkSpecSky, gkEnvY);
gkEnv += gkSpecHorizon * pow(clamp(1.0 - abs(gkReflectWS.y), 0.0, 1.0), 4.0);
vec3 gkEnvFresnel = gkFresnelBase + (1.0 - gkFresnelBase) * pow(1.0 - max(gkMatNormal.z, 0.0), 5.0);
reflectedLight.indirectSpecular = gkEnvFresnel * gkEnv * gkSpecMask * gkSpecStrength;
if (gkHasRampAdd > 0.5) {
    reflectedLight.directSpecular = mix(reflectedLight.directSpecular, reflectedLight.directSpecular * gkRampAddTint, gkRampAddSample.a);
    reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, reflectedLight.indirectSpecular * gkRampAddTint, gkRampAddSample.a);
}
vec3 gkRimDir = gkRimDirection / max(length(gkRimDirection), 0.0001);
float gkRim = pow(max(1.0 - dot(normalize(normal), gkRimDir), 0.0), max(gkRimPower, 0.0));
gkRim = min(gkRim, 1.0) * min(gkDef.r * gkDef.r, 1.0) * gkRimMask;
vec3 gkRimLit = mix(vec3(1.0), gkActorColor, clamp(gkRimAlbedo, 0.0, 1.0)) * gkRimColor * gkRimStrength * gkRim;
reflectedLight.directDiffuse += gkRimLit;
if (gkDebugView > 0) {
    vec3 gkDebugColor = diffuseColor.rgb;
    if (gkDebugView == 2) gkDebugColor = gkShade.rgb;
    if (gkDebugView == 3) gkDebugColor = gkDef.rgb;
    if (gkDebugView == 4) gkDebugColor = gkRamp.rgb;
    if (gkDebugView == 5) gkDebugColor = vec3(gkSkinMask);
    if (gkDebugView == 6) gkDebugColor = vec3(gkLighting);
    if (gkDebugView == 7) gkDebugColor = vec3(gkShadow);
    reflectedLight.directDiffuse = gkDebugColor;
    reflectedLight.indirectDiffuse = vec3(0.0);
    reflectedLight.directSpecular = vec3(0.0);
}
`);
}
