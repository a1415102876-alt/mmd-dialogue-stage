import * as THREE from './vendor/three/build/three.module.js';
import { haltonSequence } from './gakumas-scene-core.js?v=20261002-scene-lit-v7';

// These volumes are authored for HDR color before tonemapping. This pass runs
// after the scene shader has already graded into a display buffer, so the
// raw amounts blow the frame out and have to be brought back down.
const BLOOM_DISPLAY_SCALE = 0.15;
const DIFFUSION_DISPLAY_SCALE = 0.35;
const PARAFFIN_DISPLAY_SCALE = 0.2;

const POST_VERTEX = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const EXTRACT_FRAGMENT = `
uniform sampler2D gkSource;
uniform float gkThreshold;
uniform vec3 gkBloomColor;
varying vec2 vUv;
void main() {
    vec3 color = texture2D(gkSource, vUv).rgb * gkBloomColor;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float weight = smoothstep(gkThreshold, gkThreshold + 0.05, luma);
    gl_FragColor = vec4(color * weight, 1.0);
}
`;

const BLUR_FRAGMENT = `
uniform sampler2D gkSource;
uniform vec2 gkBlurTexel;
varying vec2 vUv;
void main() {
    vec3 color = texture2D(gkSource, vUv).rgb * 0.227027;
    color += texture2D(gkSource, vUv + gkBlurTexel).rgb * 0.1945946;
    color += texture2D(gkSource, vUv - gkBlurTexel).rgb * 0.1945946;
    color += texture2D(gkSource, vUv + gkBlurTexel * 2.0).rgb * 0.1216216;
    color += texture2D(gkSource, vUv - gkBlurTexel * 2.0).rgb * 0.1216216;
    color += texture2D(gkSource, vUv + gkBlurTexel * 3.0).rgb * 0.0702703;
    color += texture2D(gkSource, vUv - gkBlurTexel * 3.0).rgb * 0.0702703;
    gl_FragColor = vec4(color, 1.0);
}
`;

const TAA_FRAGMENT = `
uniform sampler2D gkCurrent;
uniform sampler2D gkHistory;
uniform sampler2D gkDepth;
uniform vec2 gkTexel;
uniform vec2 gkJitter;
uniform float gkInfluence;
uniform float gkVarianceScale;
uniform float gkHasHistory;
uniform float gkStill;
uniform float gkMotion;
uniform mat4 gkInvViewProj;
uniform mat4 gkPrevViewProj;
varying vec2 vUv;

float gkBestDepth;
vec2 gkBestOffset;
vec3 gkBoxMin;
vec3 gkBoxMax;
vec3 gkMoment1;
vec3 gkMoment2;

vec3 gkRgbToYCoCg(vec3 color) {
    return vec3(
        dot(color, vec3(0.25, 0.5, 0.25)),
        dot(color, vec3(0.5, 0.0, -0.5)),
        dot(color, vec3(-0.25, 0.5, -0.25))
    );
}

vec3 gkYCoCgToRgb(vec3 color) {
    return vec3(color.x + color.y - color.z, color.x + color.z, color.x - color.y - color.z);
}

void gkConsiderColor(vec2 uv, vec2 offset) {
    vec3 color = gkRgbToYCoCg(texture2D(gkCurrent, uv + gkTexel * offset).rgb);
    gkBoxMin = min(gkBoxMin, color);
    gkBoxMax = max(gkBoxMax, color);
    gkMoment1 += color;
    gkMoment2 += color * color;
}

void gkConsiderDepth(vec2 uv, vec2 offset) {
    float depth = texture2D(gkDepth, uv + gkTexel * offset).r;
    if (depth < gkBestDepth) {
        gkBestDepth = depth;
        gkBestOffset = offset;
    }
}

void main() {
    // The color target was rendered with a subpixel jitter. Read it back on the
    // stable pixel grid so the history is not a smear of shifted frames.
    vec2 sampleUv = clamp(vUv + gkJitter, gkTexel, vec2(1.0) - gkTexel);
    vec3 center = gkRgbToYCoCg(texture2D(gkCurrent, sampleUv).rgb);
    gkBoxMin = center;
    gkBoxMax = center;
    gkMoment1 = center;
    gkMoment2 = center * center;
    gkBestDepth = 1.0;
    gkBestOffset = vec2(0.0);
    gkConsiderColor(sampleUv, vec2(0.0, -1.0));
    gkConsiderColor(sampleUv, vec2(-1.0, 0.0));
    gkConsiderColor(sampleUv, vec2(1.0, 0.0));
    gkConsiderColor(sampleUv, vec2(0.0, 1.0));
    gkConsiderColor(sampleUv, vec2(-1.0, -1.0));
    gkConsiderColor(sampleUv, vec2(1.0, -1.0));
    gkConsiderColor(sampleUv, vec2(-1.0, 1.0));
    gkConsiderColor(sampleUv, vec2(1.0, 1.0));
    gkConsiderDepth(sampleUv, vec2(0.0, 0.0));
    gkConsiderDepth(sampleUv, vec2(0.0, -1.0));
    gkConsiderDepth(sampleUv, vec2(-1.0, 0.0));
    gkConsiderDepth(sampleUv, vec2(1.0, 0.0));
    gkConsiderDepth(sampleUv, vec2(0.0, 1.0));
    gkConsiderDepth(sampleUv, vec2(-1.0, -1.0));
    gkConsiderDepth(sampleUv, vec2(1.0, -1.0));
    gkConsiderDepth(sampleUv, vec2(-1.0, 1.0));
    gkConsiderDepth(sampleUv, vec2(1.0, 1.0));

    vec3 mean = gkMoment1 / 9.0;
    vec3 deviation = sqrt(abs(gkMoment2 / 9.0 - mean * mean));
    gkBoxMin = max(gkBoxMin, mean - gkVarianceScale * deviation);
    gkBoxMax = min(gkBoxMax, mean + gkVarianceScale * deviation);

    vec2 depthUv = sampleUv + gkTexel * gkBestOffset;
    vec3 ndc = vec3(depthUv * 2.0 - 1.0, gkBestDepth * 2.0 - 1.0);
    vec4 world = gkInvViewProj * vec4(ndc, 1.0);
    world /= world.w;
    vec4 previous = gkPrevViewProj * vec4(world.xyz, 1.0);
    vec2 historyUv = gkStill > 0.5 ? vUv : previous.xy / previous.w * 0.5 + 0.5;
    float inside = step(0.0, historyUv.x) * step(historyUv.x, 1.0) * step(0.0, historyUv.y) * step(historyUv.y, 1.0);
    vec3 rawHistory = gkRgbToYCoCg(texture2D(gkHistory, clamp(historyUv, 0.0, 1.0)).rgb);
    vec3 history = clamp(rawHistory, gkBoxMin, gkBoxMax);
    // History is 90% of a still frame. During camera or character motion that
    // trails into a smear, so hand the pixel back to the current frame.
    float reject = max(gkMotion, smoothstep(0.04, 0.18, length(rawHistory - history)));
    float influence = mix(1.0, mix(gkInfluence, 1.0, reject), inside * gkHasHistory);
    vec3 perceptualHistory = history / (history.x + 1.0);
    vec3 perceptualCenter = center / (center.x + 1.0);
    vec3 perceptual = mix(perceptualHistory, perceptualCenter, influence);
    vec3 resolved = gkYCoCgToRgb(perceptual / max(1.0 - perceptual.x, 1e-4));
    gl_FragColor = vec4(max(resolved, vec3(0.0)), 1.0);
}
`;

const COMPOSITE_FRAGMENT = `
uniform sampler2D gkSource;
uniform sampler2D gkBloomMap;
uniform sampler2D gkSoftMap;
uniform float gkBloomIntensity;
uniform float gkDiffusionBlend;
uniform float gkDiffusionThreshold;
uniform float gkDiffusionPower;
uniform float gkChroma;
uniform vec4 gkFlare0;
uniform vec4 gkFlare1;
uniform vec3 gkFlare0A;
uniform vec3 gkFlare0B;
uniform vec3 gkFlare1A;
uniform vec3 gkFlare1B;
uniform float gkFlareWeight;
uniform float gkFlareScale;
uniform vec3 gkVignetteColor;
uniform vec4 gkVignette;
uniform float gkVignetteWeight;
varying vec2 vUv;

vec3 gkFlare(vec2 uv, vec4 flare, vec3 inner, vec3 outer) {
    vec2 size = max(flare.zw, vec2(1e-3));
    float radius = length((uv - flare.xy) / size);
    float weight = exp(-radius * radius * 2.0);
    return mix(outer, inner, weight) * weight;
}

void main() {
    vec2 shift = (vUv - 0.5) * gkChroma;
    vec3 color = vec3(
        texture2D(gkSource, clamp(vUv + shift, 0.0, 1.0)).r,
        texture2D(gkSource, vUv).g,
        texture2D(gkSource, clamp(vUv - shift, 0.0, 1.0)).b
    );
    vec3 soft = texture2D(gkSoftMap, vUv).rgb;
    float contrast = abs(dot(color - soft, vec3(0.2126, 0.7152, 0.0722)));
    float response = pow(clamp(contrast / max(gkDiffusionThreshold, 1e-4), 0.0, 1.0), max(gkDiffusionPower, 1e-3));
    color = mix(color, soft, gkDiffusionBlend * (1.0 - response));
    color += texture2D(gkBloomMap, vUv).rgb * gkBloomIntensity;
    if (gkFlareWeight > 0.0) {
        color += gkFlareScale * gkFlare(vUv, gkFlare0, gkFlare0A, gkFlare0B);
        color += gkFlareScale * gkFlare(vUv, gkFlare1, gkFlare1A, gkFlare1B);
    }
    vec2 delta = abs(vUv - gkVignette.xy) * gkVignette.z;
    float vignette = pow(clamp(1.0 - length(delta), 0.0, 1.0), max(gkVignette.w, 1e-3));
    color = mix(color, mix(gkVignetteColor, color, vignette), gkVignetteWeight);
    gl_FragColor = linearToOutputTexel(vec4(max(color, vec3(0.0)), 1.0));
}
`;

function makeTarget(width, height, { depth = false } = {}) {
    const target = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: depth,
        stencilBuffer: depth,
    });
    target.texture.generateMipmaps = false;
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    return target;
}

function shader(fragment, uniforms) {
    return new THREE.ShaderMaterial({
        uniforms,
        vertexShader: POST_VERTEX,
        fragmentShader: fragment,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
    });
}

const MODULES = ['bloom', 'diffusion', 'paraffin', 'chromatic', 'vignette'];

export class GakumasPostPass {
    constructor(renderer) {
        this.renderer = renderer;
        this.enabled = false;
        this.modules = { bloom: false, diffusion: false, paraffin: false, chromatic: false, vignette: false, taa: false };
        this.taaTouched = false;
        this.settings = null;
        this.frame = 0;
        this.resetHistory = true;
        this.historyIndex = 0;
        this.jitterMatrix = new THREE.Matrix4();
        this.jitterUv = new THREE.Vector2();
        this.lastPosition = new THREE.Vector3();
        this.lastQuaternion = new THREE.Quaternion();
        this.currentViewProj = new THREE.Matrix4();
        this.currentInvViewProj = new THREE.Matrix4();
        this.previousViewProj = new THREE.Matrix4();
        this.color = makeTarget(1, 1, { depth: true });
        if ('colorSpace' in this.color.texture && THREE.SRGBColorSpace) this.color.texture.colorSpace = THREE.SRGBColorSpace;
        this.depth = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type);
        this.depth.format = THREE.DepthStencilFormat;
        this.depth.magFilter = THREE.NearestFilter;
        this.depth.minFilter = THREE.NearestFilter;
        this.color.depthTexture = this.depth;
        this.history = [makeTarget(1, 1), makeTarget(1, 1)];
        this.bloomA = makeTarget(1, 1);
        this.bloomB = makeTarget(1, 1);
        this.softA = makeTarget(1, 1);
        this.softB = makeTarget(1, 1);
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.extractMaterial = shader(EXTRACT_FRAGMENT, {
            gkSource: { value: this.color.texture },
            gkThreshold: { value: 1 },
            gkBloomColor: { value: new THREE.Color(1, 1, 1) },
        });
        this.blurMaterial = shader(BLUR_FRAGMENT, {
            gkSource: { value: null },
            gkBlurTexel: { value: new THREE.Vector2() },
        });
        this.taaMaterial = shader(TAA_FRAGMENT, {
            gkCurrent: { value: this.color.texture },
            gkHistory: { value: this.history[0].texture },
            gkDepth: { value: this.depth },
            gkTexel: { value: new THREE.Vector2() },
            gkJitter: { value: this.jitterUv },
            gkInfluence: { value: 0.1 },
            gkVarianceScale: { value: 0.55 },
            gkHasHistory: { value: 0 },
            gkStill: { value: 0 },
            gkMotion: { value: 0 },
            gkInvViewProj: { value: this.currentInvViewProj },
            gkPrevViewProj: { value: this.previousViewProj },
        });
        this.compositeMaterial = shader(COMPOSITE_FRAGMENT, {
            gkSource: { value: this.color.texture },
            gkBloomMap: { value: this.bloomA.texture },
            gkSoftMap: { value: this.softA.texture },
            gkBloomIntensity: { value: 0 },
            gkDiffusionBlend: { value: 0 },
            gkDiffusionThreshold: { value: 0.5 },
            gkDiffusionPower: { value: 1 },
            gkChroma: { value: 0 },
            gkFlare0: { value: new THREE.Vector4() },
            gkFlare1: { value: new THREE.Vector4() },
            gkFlare0A: { value: new THREE.Color() },
            gkFlare0B: { value: new THREE.Color() },
            gkFlare1A: { value: new THREE.Color() },
            gkFlare1B: { value: new THREE.Color() },
            gkFlareWeight: { value: 0 },
            gkFlareScale: { value: PARAFFIN_DISPLAY_SCALE },
            gkVignetteColor: { value: new THREE.Color() },
            gkVignette: { value: new THREE.Vector4(0.5, 0.5, 0, 0.2) },
            gkVignetteWeight: { value: 0 },
        });
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
        this.size = new THREE.Vector2();
    }

    get active() {
        return this.enabled && (this.modules.taa || MODULES.some(name => this.modules[name]));
    }

    apply(settings) {
        this.settings = settings;
        const keepTaa = this.modules.taa;
        for (const name of MODULES) this.modules[name] = !!settings?.[name]?.enabled;
        this.modules.taa = settings ? (this.taaTouched ? keepTaa : true) : false;
        this.resetHistory = true;
        this.sync();
    }

    setModule(name, enabled) {
        if (name === 'taa') {
            this.modules.taa = !!enabled;
            this.taaTouched = true;
            this.resetHistory = true;
            return;
        }
        if (!MODULES.includes(name)) return;
        this.modules[name] = !!enabled;
        this.sync();
    }

    sync() {
        const settings = this.settings || {};
        const bloom = settings.bloom || {};
        const diffusion = settings.diffusion || {};
        const flares = settings.paraffin?.flares || [{}, {}];
        const uniforms = this.compositeMaterial.uniforms;
        const extract = this.extractMaterial.uniforms;
        extract.gkThreshold.value = Number.isFinite(bloom.threshold) ? bloom.threshold : 1;
        extract.gkBloomColor.value.setRGB(...(bloom.color || [1, 1, 1]));
        uniforms.gkBloomIntensity.value = this.modules.bloom ? (bloom.intensity || 0) * BLOOM_DISPLAY_SCALE : 0;
        uniforms.gkDiffusionBlend.value = this.modules.diffusion ? (diffusion.blend || 0) * DIFFUSION_DISPLAY_SCALE : 0;
        uniforms.gkDiffusionThreshold.value = diffusion.contrastThreshold ?? 0.5;
        uniforms.gkDiffusionPower.value = Math.max(diffusion.contrastPower || 1, 1e-3);
        // Volume intensity is the URP spectral amount. Used raw it splits the
        // frame by tens of pixels, so keep only the edge fringe.
        uniforms.gkChroma.value = this.modules.chromatic ? (settings.chromatic?.intensity || 0) * 0.15 : 0;
        this.writeFlare(0, flares[0]);
        this.writeFlare(1, flares[1]);
        uniforms.gkFlareWeight.value = this.modules.paraffin ? 1 : 0;
        const vignette = settings.vignette || {};
        uniforms.gkVignetteColor.value.setRGB(...(vignette.color || [0, 0, 0]));
        uniforms.gkVignette.value.set(vignette.center?.[0] ?? 0.5, vignette.center?.[1] ?? 0.5, vignette.intensity || 0, Math.max(vignette.smoothness || 0.2, 1e-3));
        uniforms.gkVignetteWeight.value = this.modules.vignette ? 1 : 0;
        this.bloomRadius = this.modules.bloom ? (bloom.diffusion || 0) * 2 : 0;
        this.softRadius = this.modules.diffusion ? (diffusion.diffusion || 0) * 64 : 0;
    }

    writeFlare(index, flare = {}) {
        const uniforms = this.compositeMaterial.uniforms;
        const box = index === 0 ? uniforms.gkFlare0 : uniforms.gkFlare1;
        const inner = index === 0 ? uniforms.gkFlare0A : uniforms.gkFlare1A;
        const outer = index === 0 ? uniforms.gkFlare0B : uniforms.gkFlare1B;
        box.value.set(flare.center?.[0] || 0, flare.center?.[1] || 0, flare.size?.[0] || 0, flare.size?.[1] || 0);
        inner.value.setRGB(...(flare.color0 || [0, 0, 0]));
        outer.value.setRGB(...(flare.color1 || [0, 0, 0]));
    }

    setSize(width, height) {
        const pixelRatio = this.renderer.getPixelRatio();
        const w = Math.max(1, Math.floor(width * pixelRatio));
        const h = Math.max(1, Math.floor(height * pixelRatio));
        if (this.color.width === w && this.color.height === h) return;
        this.color.setSize(w, h);
        for (const target of this.history) target.setSize(w, h);
        const hw = Math.max(1, Math.floor(w / 2));
        const hh = Math.max(1, Math.floor(h / 2));
        for (const target of [this.bloomA, this.bloomB, this.softA, this.softB]) target.setSize(hw, hh);
        this.resetHistory = true;
    }

    applyJitter(viewCamera) {
        const index = (this.frame & 1023) + 1;
        this.jitterUv.set((haltonSequence(index, 2) - 0.5) / this.color.width, (haltonSequence(index, 3) - 0.5) / this.color.height);
        viewCamera.updateMatrixWorld();
        viewCamera.updateProjectionMatrix();
        this.jitterMatrix.makeTranslation(this.jitterUv.x * 2, this.jitterUv.y * 2, 0);
        viewCamera.projectionMatrix.premultiply(this.jitterMatrix);
        viewCamera.projectionMatrixInverse.copy(viewCamera.projectionMatrix).invert();
    }

    clearJitter(viewCamera) {
        viewCamera.updateProjectionMatrix();
    }

    resolveHistory(viewCamera) {
        this.currentViewProj.multiplyMatrices(viewCamera.projectionMatrix, viewCamera.matrixWorldInverse);
        this.currentInvViewProj.copy(this.currentViewProj).invert();
        const read = this.history[this.historyIndex];
        const write = this.history[1 - this.historyIndex];
        const uniforms = this.taaMaterial.uniforms;
        uniforms.gkHistory.value = read.texture;
        uniforms.gkTexel.value.set(1 / this.color.width, 1 / this.color.height);
        uniforms.gkInfluence.value = 0.1;
        uniforms.gkVarianceScale.value = 0.7;
        uniforms.gkHasHistory.value = this.resetHistory ? 0 : 1;
        const movedPixels = this.lastPosition.distanceTo(viewCamera.position) * this.color.height * 0.15
            + this.lastQuaternion.angleTo(viewCamera.quaternion) * (this.color.height / Math.max(viewCamera.fov, 1));
        const still = movedPixels < 0.25;
        uniforms.gkStill.value = still ? 1 : 0;
        uniforms.gkMotion.value = Math.min(1, movedPixels / 6);
        this.lastPosition.copy(viewCamera.position);
        this.lastQuaternion.copy(viewCamera.quaternion);
        this.blit(this.taaMaterial, write);
        this.historyIndex = 1 - this.historyIndex;
        this.clearJitter(viewCamera);
        viewCamera.updateMatrixWorld();
        this.previousViewProj.multiplyMatrices(viewCamera.projectionMatrix, viewCamera.matrixWorldInverse);
        this.resetHistory = false;
        this.frame += 1;
        return write;
    }

    blit(material, target) {
        this.mesh.material = material;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);
    }

    blur(source, radius, ping, pong) {
        const texel = this.blurMaterial.uniforms.gkBlurTexel.value;
        texel.set(radius / ping.width, 0);
        this.blurMaterial.uniforms.gkSource.value = source.texture;
        this.blit(this.blurMaterial, ping);
        texel.set(0, radius / pong.height);
        this.blurMaterial.uniforms.gkSource.value = ping.texture;
        this.blit(this.blurMaterial, pong);
        return pong;
    }

    render(draw, viewCamera) {
        this.renderer.getSize(this.size);
        this.setSize(this.size.x, this.size.y);
        const useTaa = this.modules.taa && !!viewCamera;
        const autoClear = this.renderer.autoClear;
        this.renderer.autoClear = true;
        if (useTaa) this.applyJitter(viewCamera);
        this.renderer.setRenderTarget(this.color);
        this.renderer.clear(true, true, true);
        try {
            draw();
            const resolved = useTaa ? this.resolveHistory(viewCamera) : null;
            if (useTaa) this.clearJitter(viewCamera);
            const source = resolved ? resolved.texture : this.color.texture;
            this.extractMaterial.uniforms.gkSource.value = source;
            this.compositeMaterial.uniforms.gkSource.value = source;
            if (this.modules.bloom && this.bloomRadius > 0) {
                this.blit(this.extractMaterial, this.bloomA);
                const bloom = this.blur(this.bloomA, this.bloomRadius, this.bloomB, this.bloomA);
                this.compositeMaterial.uniforms.gkBloomMap.value = bloom.texture;
            }
            if (this.modules.diffusion && this.softRadius > 0) {
                const soft = this.blur(resolved || this.color, this.softRadius, this.softA, this.softB);
                this.compositeMaterial.uniforms.gkSoftMap.value = soft.texture;
            }
            this.renderer.setRenderTarget(null);
            this.renderer.autoClear = false;
            this.blit(this.compositeMaterial, null);
        } finally {
            if (useTaa) this.clearJitter(viewCamera);
            this.renderer.setRenderTarget(null);
            this.renderer.autoClear = autoClear;
        }
    }

    dispose() {
        for (const target of [this.color, this.history[0], this.history[1], this.bloomA, this.bloomB, this.softA, this.softB]) target.dispose();
        this.depth.dispose();
        this.extractMaterial.dispose();
        this.blurMaterial.dispose();
        this.taaMaterial.dispose();
        this.compositeMaterial.dispose();
        this.mesh.geometry.dispose();
    }
}
