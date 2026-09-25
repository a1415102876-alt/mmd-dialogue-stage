import * as THREE from './vendor/three/build/three.module.js';

export const GAKUMAS_LOOK = Object.freeze({
    key: 0.9,
    hemi: 0,
    rim: 0.42,
    shadow: 0.82,
    keyAzimuth: 34,
    keyElevation: 16,
    shadowAzimuth: 34,
    shadowElevation: 16,
    keyColor: '#ffffff',
    rimColor: '#ffb197',
    skinSaturation: 1.32,
    lightTermOffset: 0.16,
    shadowFloor: 0.22,
    specStrength: 0.38,
    shadeMultiply: [1, 1, 1],
    specSky: [0.72, 0.74, 0.78],
    specFloor: [0.16, 0.14, 0.13],
    specHorizon: [0.55, 0.42, 0.34],
    contrast: 1,
    saturation: 1.1,
    warmth: [1.03, 0.995, 0.96],
    bloom: 0.2,
    bloomKnee: 0.72,
    bloomRadius: 1,
});

function cloneLookBloom(look = GAKUMAS_LOOK) {
    return {
        intensity: look.bloom,
        knee: look.bloomKnee,
        radius: look.bloomRadius,
    };
}

export function applyGakumasLookUniforms(uniforms, look = GAKUMAS_LOOK) {
    if (!uniforms) return uniforms;
    if (uniforms.gkLightTermOffset) uniforms.gkLightTermOffset.value = look.lightTermOffset;
    if (uniforms.gkShadowFloor) uniforms.gkShadowFloor.value = look.shadowFloor;
    if (uniforms.gkSkinSaturation) uniforms.gkSkinSaturation.value = look.skinSaturation;
    if (uniforms.gkShadeMultiply) uniforms.gkShadeMultiply.value.setRGB(...look.shadeMultiply);
    if (uniforms.gkSpecSky) uniforms.gkSpecSky.value.setRGB(...look.specSky);
    if (uniforms.gkSpecFloor) uniforms.gkSpecFloor.value.setRGB(...look.specFloor);
    if (uniforms.gkSpecHorizon) uniforms.gkSpecHorizon.value.setRGB(...look.specHorizon);
    if (uniforms.gkSpecStrength) uniforms.gkSpecStrength.value = look.specStrength;
    return uniforms;
}

export function createGakumasLookUniformValues(look = GAKUMAS_LOOK) {
    return {
        gkLightTermOffset: { value: look.lightTermOffset },
        gkShadowFloor: { value: look.shadowFloor },
        gkSkinSaturation: { value: look.skinSaturation },
        gkShadeMultiply: { value: new THREE.Color().setRGB(look.shadeMultiply[0], look.shadeMultiply[1], look.shadeMultiply[2]) },
        gkSpecSky: { value: new THREE.Color().setRGB(look.specSky[0], look.specSky[1], look.specSky[2]) },
        gkSpecFloor: { value: new THREE.Color().setRGB(look.specFloor[0], look.specFloor[1], look.specFloor[2]) },
        gkSpecHorizon: { value: new THREE.Color().setRGB(look.specHorizon[0], look.specHorizon[1], look.specHorizon[2]) },
        gkSpecStrength: { value: look.specStrength },
    };
}

const LOOK_VERTEX = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const LOOK_FRAGMENT = `
uniform sampler2D gkLookMap;
uniform vec2 gkLookTexel;
uniform float gkLookContrast;
uniform float gkLookSaturation;
uniform vec3 gkLookWarmth;
uniform float gkLookBloom;
uniform float gkLookKnee;
uniform float gkLookRadius;
varying vec2 vUv;

vec3 gkSample(vec2 uv) {
    return texture2D(gkLookMap, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

void main() {
    vec4 source = texture2D(gkLookMap, vUv);
    vec2 texel = gkLookTexel * max(gkLookRadius, 0.0);
    vec3 bloom = (
        gkSample(vUv + vec2(texel.x, 0.0)) +
        gkSample(vUv - vec2(texel.x, 0.0)) +
        gkSample(vUv + vec2(0.0, texel.y)) +
        gkSample(vUv - vec2(0.0, texel.y))
    ) * 0.25;
    vec3 highlight = max(bloom - vec3(gkLookKnee), vec3(0.0));
    vec3 color = source.rgb + highlight * gkLookBloom;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, gkLookSaturation);
    color = mix(color, (color - 0.5) * gkLookContrast + 0.5, smoothstep(0.14, 0.42, luma));
    color *= gkLookWarmth;
    gl_FragColor = linearToOutputTexel(vec4(max(color, vec3(0.0)), source.a));
}
`;

export class GakumasLookPass {
    constructor(renderer) {
        this.renderer = renderer;
        this.enabled = false;
        this.target = new THREE.WebGLRenderTarget(1, 1, {
            depthBuffer: true,
            stencilBuffer: true,
        });
        // Three compiles actor shaders with Linear output whenever the current
        // target is a regular RT. Store that linear lighting in an sRGB buffer
        // so 8-bit toon shades keep PNG-like darks, then encode once here.
        this.target.texture.generateMipmaps = false;
        this.target.texture.minFilter = THREE.LinearFilter;
        this.target.texture.magFilter = THREE.LinearFilter;
        if ('colorSpace' in this.target.texture && THREE.SRGBColorSpace) {
            this.target.texture.colorSpace = THREE.SRGBColorSpace;
        }
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                gkLookMap: { value: this.target.texture },
                gkLookTexel: { value: new THREE.Vector2(1, 1) },
                gkLookContrast: { value: GAKUMAS_LOOK.contrast },
                gkLookSaturation: { value: GAKUMAS_LOOK.saturation },
                gkLookWarmth: { value: new THREE.Color().setRGB(GAKUMAS_LOOK.warmth[0], GAKUMAS_LOOK.warmth[1], GAKUMAS_LOOK.warmth[2]) },
                gkLookBloom: { value: GAKUMAS_LOOK.bloom },
                gkLookKnee: { value: GAKUMAS_LOOK.bloomKnee },
                gkLookRadius: { value: GAKUMAS_LOOK.bloomRadius },
            },
            vertexShader: LOOK_VERTEX,
            fragmentShader: LOOK_FRAGMENT,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
        this.size = new THREE.Vector2();
        this.bloom = cloneLookBloom();
    }

    setBloom({ intensity, knee, radius } = {}) {
        if (Number.isFinite(intensity)) this.bloom.intensity = Math.max(0, intensity);
        if (Number.isFinite(knee)) this.bloom.knee = Math.max(0, Math.min(1, knee));
        if (Number.isFinite(radius)) this.bloom.radius = Math.max(0, radius);
        this.material.uniforms.gkLookBloom.value = this.bloom.intensity;
        this.material.uniforms.gkLookKnee.value = this.bloom.knee;
        this.material.uniforms.gkLookRadius.value = this.bloom.radius;
        return this.bloom;
    }

    setSize(width, height) {
        const pixelRatio = this.renderer.getPixelRatio();
        const w = Math.max(1, Math.floor(width * pixelRatio));
        const h = Math.max(1, Math.floor(height * pixelRatio));
        if (this.target.width === w && this.target.height === h) return;
        this.target.setSize(w, h);
        this.material.uniforms.gkLookTexel.value.set(1 / w, 1 / h);
    }

    begin() {
        this.renderer.getSize(this.size);
        this.setSize(this.size.x, this.size.y);
        this.renderer.setRenderTarget(this.target);
        this.renderer.clear(true, true, true);
    }

    end() {
        const autoClear = this.renderer.autoClear;
        this.renderer.setRenderTarget(null);
        this.renderer.autoClear = false;
        this.renderer.render(this.scene, this.camera);
        this.renderer.autoClear = autoClear;
    }

    render(draw) {
        this.begin();
        try {
            draw();
        } finally {
            this.end();
        }
    }

    dispose() {
        this.target.dispose();
        this.material.dispose();
        this.mesh.geometry.dispose();
    }
}
