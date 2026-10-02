import * as THREE from './vendor/three/build/three.module.js';
import { isHairCoverSourceMaterial } from './gakumas-passes.js?v=20261003-hair-cover-fix-v8';
import { injectActorShader } from './gakumas-shader.js?v=20261003-hair-cover-fix-v8';

export const HAIR_FADE_PARAMETERS = Object.freeze([0.75, 2, 0.4, 4]);

export function evaluateHairCoverAlpha(facing, vertical, mask, minimum = 0, parameters = HAIR_FADE_PARAMETERS) {
    const clamp = value => Math.max(0, Math.min(1, value));
    const fadeX = clamp((parameters[0] - facing) * parameters[1]);
    const fadeZ = clamp((Math.abs(vertical) - parameters[2]) * parameters[3]);
    return 1 + (Math.max(fadeX, fadeZ, clamp(minimum)) - 1) * clamp(mask);
}

function isVisible(mesh, camera) {
    if (!mesh.layers.test(camera.layers)) return false;
    for (let ancestor = mesh; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible) return false;
    }
    return true;
}

export class HairCoverStage {
    constructor() {
        this.entries = [];
        this.lastDraws = [];
        this.active = false;
        this.uniforms = {
            gkHairHeadForward: { value: new THREE.Vector3(0, 0, 1) },
            gkHairHeadUp: { value: new THREE.Vector3(0, 1, 0) },
            gkHairFadeParameters: { value: new THREE.Vector4(...HAIR_FADE_PARAMETERS) },
            gkHairMinimumCoverage: { value: 0.35 },
        };
    }

    add(mesh, source, materialIndex, actorUniforms, textureName) {
        if (!isHairCoverSourceMaterial(source.name, textureName)) return;
        const geometry = mesh.geometry;
        const groups = Array.isArray(mesh.material)
            ? geometry.groups.filter(group => group.materialIndex === materialIndex)
            : [{ start: 0, count: geometry.index?.count ?? geometry.attributes.position.count, materialIndex: 0 }];
        if (!groups.length) return;
        const material = source.clone();
        for (const [name, uniform] of Object.entries(source.uniforms || {})) {
            if (!uniform.value?.isTexture) continue;
            const copiedTexture = material.uniforms[name].value;
            if (copiedTexture && copiedTexture !== uniform.value) copiedTexture.dispose();
            material.uniforms[name].value = uniform.value;
        }
        material.name = `${source.name}:HairCover`;
        material.defines = { ...source.defines, GK_HAIR: true, GK_FACE: false, GK_EYE: false, GK_HAIR_COVER_PASS: true };
        delete material.defines.GK_HAIR_COVER;
        material.transparent = true;
        material.depthWrite = false;
        material.depthTest = true;
        material.depthFunc = THREE.LessEqualDepth;
        material.polygonOffset = false;
        // Face, brows and eye white all write stencil 64 or above. The second
        // hair pass is gated by that existing mask and uses a zero write mask,
        // so it can reveal the eyes without changing the mask for later
        // passes. Keeping the test here also prevents the pass from painting
        // over the separate m_hir+ highlight geometry outside the face.
        material.stencilWrite = true;
        material.stencilFunc = THREE.GreaterEqualStencilFunc;
        material.stencilRef = 64;
        material.stencilFuncMask = 0xff;
        material.stencilWriteMask = 0;
        material.stencilFail = THREE.KeepStencilOp;
        material.stencilZFail = THREE.KeepStencilOp;
        material.stencilZPass = THREE.KeepStencilOp;
        material.alphaTest = 0;
        material.colorWrite = true;
        material.blending = THREE.CustomBlending;
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.SrcAlphaFactor;
        material.blendDst = THREE.OneMinusSrcAlphaFactor;
        material.blendEquationAlpha = THREE.AddEquation;
        material.blendSrcAlpha = THREE.OneFactor;
        material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        material.premultipliedAlpha = false;
        material.onBeforeCompile = shader => injectActorShader(shader, { ...actorUniforms, ...this.uniforms });
        material.customProgramCacheKey = () => 'gakumas-actor-hair-cover-pass-view-v8';
        this.entries.push({ mesh, source, material, groups });
    }

    update(head, minimumCoverage) {
        if (head) {
            this.uniforms.gkHairHeadForward.value.setFromMatrixColumn(head.matrixWorld, 2).normalize();
            this.uniforms.gkHairHeadUp.value.setFromMatrixColumn(head.matrixWorld, 1).normalize();
        }
        this.uniforms.gkHairMinimumCoverage.value = Math.max(0, Math.min(1, minimumCoverage));
    }

    draw(renderer, scene, camera) {
        for (const { mesh, source, material, groups } of this.entries) {
            if (!source.visible || !isVisible(mesh, camera)) continue;
            mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld);
            mesh.normalMatrix.getNormalMatrix(mesh.modelViewMatrix);
            material.opacity = source.opacity;
            material.color.copy(source.color);
            for (const group of groups) {
                renderer.renderBufferDirect(camera, scene, mesh.geometry, material, mesh, group);
                this.lastDraws.push({ name: source.name, start: group.start, count: group.count, materialIndex: group.materialIndex });
            }
        }
    }

    renderFrame(renderer, outline, scene, camera, enabled) {
        this.lastDraws = [];
        const originalSceneAfter = scene.onAfterRender;
        if (enabled && this.entries.length) {
            if (camera.isArrayCamera) {
                throw new Error('HairCover currently requires a single camera');
            }
            this.active = true;
            // Draw after the eyes. Mesh onAfterRender runs in the opaque pass,
            // before the transparent eye cards, so the eyes would cover the fade.
            scene.onAfterRender = (activeRenderer, activeScene, activeCamera) => {
                if (this.active) this.draw(activeRenderer, activeScene, activeCamera);
                if (originalSceneAfter) originalSceneAfter.call(scene, activeRenderer, activeScene, activeCamera);
            };
        }
        try {
            renderer.render(scene, camera);
        } finally {
            this.active = false;
            scene.onAfterRender = originalSceneAfter;
        }
        if (outline.enabled) outline.renderOutline(scene, camera);
    }

    dispose() {
        this.entries.forEach(entry => entry.material.dispose());
        this.entries = [];
        this.lastDraws = [];
    }
}

