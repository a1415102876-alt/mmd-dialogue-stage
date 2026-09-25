import * as THREE from './vendor/three/build/three.module.js';
import { shouldWriteHairShadow } from './gakumas-passes.js';

export const HAIR_SHADOW_FOCUS = 12;
// World units, not window depth: the occluder must be at least this much closer
// to the camera than the shaded pixel.
export const HAIR_SHADOW_BIAS = 0.012;

// Matches perspectiveDepthToViewZ from the three.js packing chunk, negated so it
// returns a positive distance along the view axis.
export function viewDistanceFromDepth(depth, near, far) {
    return (near * far) / (far - (far - near) * depth);
}

function isVisible(mesh, camera) {
    if (!mesh.layers.test(camera.layers)) return false;
    for (let ancestor = mesh; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible) return false;
    }
    return true;
}

export function evaluateHairShadow(hairMask, hairDepth, faceDepth, bias = HAIR_SHADOW_BIAS) {
    return hairMask > 0.5 && hairDepth + bias < faceDepth ? 0 : 1;
}

export function hairShadowOffsetUV(screenUV, lightVS, viewZ, offsetPx, resolution, focus = HAIR_SHADOW_FOCUS) {
    const scale = (offsetPx * focus) / Math.max(viewZ, 0.001);
    const width = Math.max(resolution[0], 1);
    const height = Math.max(resolution[1], 1);
    return [
        Math.max(0, Math.min(1, screenUV[0] + lightVS[0] * scale / width)),
        Math.max(0, Math.min(1, screenUV[1] + lightVS[1] * scale / height)),
    ];
}

export class HairShadowStage {
    constructor() {
        this.entries = [];
        this.lastDraws = [];
        this.target = null;
        this.resolution = new THREE.Vector2(1, 1);
        this.emptyMap = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
        this.emptyMap.needsUpdate = true;
        this.emptyDepth = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
        this.emptyDepth.needsUpdate = true;
    }

    add(mesh, source, materialIndex) {
        const actorPass = source.userData?.gakumasActorPass;
        if (!shouldWriteHairShadow(actorPass)) return;
        const geometry = mesh.geometry;
        const groups = Array.isArray(mesh.material)
            ? geometry.groups.filter(group => group.materialIndex === materialIndex)
            : [{ start: 0, count: geometry.index?.count ?? geometry.attributes.position.count, materialIndex: 0 }];
        if (!groups.length) return;
        // BasicDepthPacking leaves alpha at the material opacity, so the cleared
        // target's alpha 0 becomes an unambiguous "hair drew here" mask. Precise
        // depth comes from the attached DepthTexture instead of packed color.
        const material = new THREE.MeshDepthMaterial({
            depthPacking: THREE.BasicDepthPacking,
            alphaTest: source.alphaTest || 0.33,
            side: THREE.FrontSide,
        });
        material.name = `${source.name}:HairShadow`;
        material.skinning = true;
        material.morphTargets = true;
        material.map = source.map || null;
        material.alphaMap = source.map || null;
        material.stencilWrite = false;
        this.entries.push({ mesh, source, material, groups });
    }

    ensureTarget(renderer) {
        renderer.getDrawingBufferSize(this.resolution);
        const width = Math.max(1, Math.floor(this.resolution.x));
        const height = Math.max(1, Math.floor(this.resolution.y));
        if (this.target && this.target.width === width && this.target.height === height) return this.target;
        this.target?.dispose();
        const depthTexture = new THREE.DepthTexture(width, height);
        depthTexture.format = THREE.DepthFormat;
        depthTexture.type = THREE.UnsignedIntType;
        depthTexture.minFilter = THREE.NearestFilter;
        depthTexture.magFilter = THREE.NearestFilter;
        this.target = new THREE.WebGLRenderTarget(width, height, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            type: THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            depthBuffer: true,
            stencilBuffer: false,
            depthTexture,
        });
        this.target.texture.generateMipmaps = false;
        return this.target;
    }

    capture(renderer, scene, camera) {
        this.lastDraws = [];
        if (!this.entries.length) return null;
        const target = this.ensureTarget(renderer);
        const previousTarget = renderer.getRenderTarget();
        const previousAutoClear = renderer.autoClear;
        const previousShadow = renderer.shadowMap.enabled;
        const previousClearColor = new THREE.Color();
        const previousClearAlpha = renderer.getClearAlpha();
        renderer.getClearColor(previousClearColor);
        const kept = new Set();
        const hidden = [];
        const swaps = [];
        for (const { mesh, source, material, groups } of this.entries) {
            if (!source.visible || !isVisible(mesh, camera)) continue;
            material.map = source.map || null;
            material.alphaMap = source.map || null;
            material.alphaTest = source.alphaTest || 0.33;
            for (let node = mesh; node; node = node.parent) kept.add(node);
            const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const group of groups) {
                swaps.push({ mesh, list, index: group.materialIndex, original: list[group.materialIndex] });
                list[group.materialIndex] = material;
                this.lastDraws.push({ name: source.name, start: group.start, count: group.count, materialIndex: group.materialIndex });
            }
            if (Array.isArray(mesh.material)) mesh.material = list;
            else mesh.material = list[0];
        }
        for (const mesh of new Set(this.entries.map(entry => entry.mesh))) {
            const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            list.forEach(material => {
                if (this.entries.some(entry => entry.mesh === mesh && entry.material === material)) return;
                if (!material.visible) return;
                hidden.push({ object: material, key: 'visible', value: true });
                material.visible = false;
            });
        }
        scene.traverse(object => {
            if (object === scene || kept.has(object) || !object.visible) return;
            hidden.push({ object, key: 'visible', value: true });
            object.visible = false;
        });
        renderer.setRenderTarget(target);
        renderer.autoClear = true;
        renderer.shadowMap.enabled = false;
        renderer.setClearColor(new THREE.Color(0, 0, 0), 0);
        try {
            renderer.render(scene, camera);
        } finally {
            for (const { mesh, list, index, original } of swaps) {
                list[index] = original;
                if (Array.isArray(mesh.material)) mesh.material = list;
                else mesh.material = list[0];
            }
            for (const item of hidden) item.object[item.key] = item.value;
            renderer.setRenderTarget(previousTarget);
            renderer.autoClear = previousAutoClear;
            renderer.shadowMap.enabled = previousShadow;
            renderer.setClearColor(previousClearColor, previousClearAlpha);
        }
        return target.texture;
    }

    map() {
        return this.target?.texture || this.emptyMap;
    }

    depthMap() {
        return this.target?.depthTexture || this.emptyDepth;
    }

    dispose() {
        this.entries.forEach(entry => entry.material.dispose());
        this.entries = [];
        this.lastDraws = [];
        this.target?.dispose();
        this.target = null;
    }
}
