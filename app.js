import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js?v=20260909-outline1';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js?v=20260909-outline1';
import { EXPRESSION_PRESETS, MOTION_BUCKETS, MOTION_FADE, buildPlaylist, classifyClipTracks, findPresetMorph, indexMotionFiles, normalizeActionId, parsePerformanceCommand, playlistClipIds, sortPlaylistByCatalog, canKeepBodyForFace, fadeDurationForClip, fadeDurationForTransition, findIdlePlaylistIndex, findFacePlaylistIndex, findGesturePlaylistIndex, shouldLoopMotion } from './core.js?v=20260914-idol-types';
import { LIBRARY_R2_KEY, LIBRARY_SOURCE_KEY, idolAssetUrls, motionAssetUrls, motionAvailability, resolveLibrarySource, sourceLabel } from './library-client.js?v=20260913-nested-motion';
import { GAKUMAS_TEXTURE_KINDS, GAKUMAS_ACTIVE_TEXTURE_KINDS, selectMaterialTextures, textureDescriptor, textureUsesColorSpace, setTextureColorSpace } from './gakumas-materials.js?v=20260911-look6';
import { injectActorShader } from './gakumas-shader.js?v=20260911-look5';
import { actorStencilState, classifyActorPass, shouldCastCharacterShadow, shouldReceiveCharacterShadow, shouldReceiveHairShadow, shouldWriteHairShadow } from './gakumas-passes.js?v=20260910-hairshadow3';
import { HairCoverStage } from './gakumas-hair-cover.js?v=20260911-look5';
import { GAKUMAS_LOOK, GakumasLookPass, applyGakumasLookUniforms, createGakumasLookUniformValues } from './gakumas-look.js?v=20260911-defaults7';
import { HAIR_SHADOW_BIAS, HAIR_SHADOW_FOCUS, HairShadowStage } from './gakumas-hair-shadow.js?v=20260910-hairshadow3';
import { hasGakumasVertexColorAttribute } from './gakumas-outline.js?v=20260909-outline1';
import { SecondaryMotion } from './gakumas-secondary-motion.js?v=20260925-ttmr-native-hair-frame-v1';
import { identifyLibraryIdol, supportsSecondaryMotion, motionMatchesIdol } from './idol-library.js?v=20260912-all-idols';
import { bindVisemeMorphs, estimateVisemeTrack, faceCueLabel, gestureCueLabel, isFacialNoiseMorph, parseAiCue, restoreVisemeInfluences, shouldClearFacialNoise, snapshotVisemeInfluences, visemeWeightAt, allVisemeBindingTargets, visemeBindingTargets } from './dialogue-intent.js?v=20260913-numbered';

const $ = selector => document.querySelector(selector);
const state = {
    model: null,
    helper: new MMDAnimationHelper({ afterglow: 0, sync: true }),
    actions: new Map(),
    playlist: [],
    playlistIndex: -1,
    liveActions: [],
    fadingActions: [],
    playGeneration: 0,
    finishedHandler: null,
    pendingFinish: null,
    motionFilter: 'all',
    library: { config: null, map: null, status: null, indexByPack: new Map(), activeIdol: '' },
    activeClipIds: [],
    restPose: null,
    objectUrls: [],
    modelFile: null,
    textureFiles: [],
    activeAction: '',
    activeExpression: 'neutral',
    stickyFace: { id: '', intensity: 1 },
    lastCuePick: { gestureKey: '', faceKey: '' },
    lipSync: { bound: {}, track: [], startedAt: 0, active: false, savedMouth: null },
    playing: false,
    renderPreset: 'mmd',
    materialMode: 'mmd',
    hemiBaseIntensity: GAKUMAS_LOOK.hemi,
    shadowStrength: GAKUMAS_LOOK.shadow,
    shadowFloor: 0.22,
    shadowAzimuth: GAKUMAS_LOOK.shadowAzimuth,
    shadowElevation: GAKUMAS_LOOK.shadowElevation,
    gakumasUniforms: new Set(),
    gakumasTextures: [],
    gakumasFallbacks: {},
    gakumasHeadBone: null,
    gakumasHeadRight: new THREE.Vector3(1, 0, 0),
    gakumasLightDirection: new THREE.Vector3(),
    gakumasDebugView: 0,
    gakumasPasses: { characterShadow: true, hairCover: true, hairCoverMinimum: 0.35, hairShadow: true, hairShadowOffset: 32 },
    outline: { color: '#000000', alpha: 0.82, thickness: 0.004 },
};
const clock = new THREE.Clock();
const hairCoverStage = new HairCoverStage();
const hairShadowStage = new HairShadowStage();
const hairShadowLightVS = new THREE.Vector3();
const secondaryMotion = new SecondaryMotion();
const colliderDebug = {
    enabled: false,
    group: new THREE.Group(),
    staticMeshes: [],
    particleMeshes: [],
};
colliderDebug.group.visible = false;
const colliderDebugUp = new THREE.Vector3(0, 1, 0);
const colliderDebugDir = new THREE.Vector3();
const secondaryMotionTables = new Map();
const clothingTraceStatus = () => { const node=$('clothingTraceStatus'); if (node) { const s=secondaryMotion.getClothingTraceStatus(); node.textContent=s.active ? `衣物诊断：${s.ticks}/300 帧${s.complete ? '（已完成）' : ''}` : '未记录'; } };
let secondaryMotionBindGeneration = 0;
const secondaryMotionReady = idolId => {
    const key = idolId || 'fallback';
    if (secondaryMotionTables.has(key)) return secondaryMotionTables.get(key);
    const request = fetch(`./secondary-motion-profiles/${encodeURIComponent(idolId || 'fktn')}.json?v=20260925-ttmr-native-hair-frame-v1`)
        .then(response => response.ok ? response.json() : fetch(`./gakumas-secondary-motion.json?v=20260925-ttmr-native-hair-frame-v1`).then(fallback => {
            if (!fallback.ok) throw new Error(fallback.statusText);
            return fallback.json();
        }))
        .then(table => table)
        .catch(error => { console.error('[MMD Stage] secondary motion table failed', error); return null; });
    secondaryMotionTables.set(key, request);
    return request;
};

const canvas = $('#stageCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
// Three.js 0.152 uses outputEncoding; keep the newer property for builds
// that expose it, but avoid leaving the renderer in an un-tonemapped state.
if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const outlineEffect = new OutlineEffect(renderer, {
    defaultThickness: 0.004,
    defaultColor: [0.045, 0.06, 0.075],
    defaultAlpha: 0.82,
    defaultKeepAlive: true,
});
const lookPass = new GakumasLookPass(renderer);

const scene = new THREE.Scene();
scene.add(colliderDebug.group);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 1000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 9, 0);
controls.minDistance = 5;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.49;

const hemi = new THREE.HemisphereLight(0xdce8ff, 0x6d7777, 0.32);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
keyLight.position.set(8, 16, 10);
keyLight.target.position.set(0, 8, 0);
scene.add(keyLight.target);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -14;
keyLight.shadow.camera.right = 14;
keyLight.shadow.camera.top = 22;
keyLight.shadow.camera.bottom = -4;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 60;
keyLight.shadow.bias = -0.00035;
keyLight.shadow.normalBias = 0.035;
scene.add(keyLight);
// MMDToonMaterial builds can ignore directional uniforms; this co-located
// point light provides a reliable direct-light path for those builds.
const keyPointLight = new THREE.PointLight(0xffffff, 0.9, 0, 0);
keyPointLight.position.copy(keyLight.position);
scene.add(keyPointLight);
const rimLight = new THREE.DirectionalLight(0xffaa92, 0.26);
rimLight.position.set(-8, 10, -7);
scene.add(rimLight);
// A separate character-only shadow caster keeps scene shadows out of the actor.
const characterShadowLight = new THREE.DirectionalLight(0xffffff, 0.0);
characterShadowLight.position.set(5, 18, 8);
characterShadowLight.target.position.set(0, 8, 0);
characterShadowLight.castShadow = true;
characterShadowLight.shadow.mapSize.set(2048, 2048);
characterShadowLight.shadow.camera.left = -10;
characterShadowLight.shadow.camera.right = 10;
characterShadowLight.shadow.camera.top = 18;
characterShadowLight.shadow.camera.bottom = -2;
characterShadowLight.shadow.camera.near = 0.5;
characterShadowLight.shadow.camera.far = 50;
characterShadowLight.shadow.bias = -0.0002;
characterShadowLight.shadow.normalBias = 0.045;
characterShadowLight.userData.gakumasCharacterShadow = true;
scene.add(characterShadowLight.target, characterShadowLight);
const characterShadowFit = { center: new THREE.Vector3(0, 8, 0), radius: 10 };
const characterShadowTravel = new THREE.Vector3();

const floor = new THREE.Mesh(
    new THREE.CircleGeometry(18, 96),
    new THREE.MeshStandardMaterial({ color: 0xe8efee, roughness: 0.92, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(36, 36, 0x91aaa7, 0xc8d6d4);
grid.position.y = 0.012;
grid.material.transparent = true;
grid.material.opacity = 0.34;
scene.add(grid);

resetCamera();
buildExpressionButtons();
bindUi();
applyRenderPreset('mmd');
setStatus('3D 运行库已就绪', 'ready');
initLibrary();
animate();

function bindUi() {
    if (!window.mmdStagePickerHandled) {
        $('#emptyImportBtn')?.addEventListener('click', () => $('#modelFileInput').click());
        $('#importModelBtn').addEventListener('click', () => $('#modelFileInput').click());
        $('#importTextureBtn').addEventListener('click', () => $('#textureFolderInput').click());
        $('#importMotionBtn').addEventListener('click', () => $('#motionInput').click());
    }
    $('#emptyLoadIdolBtn')?.addEventListener('click', () => loadIdol('fktn'));
    $('#modelFileInput').addEventListener('change', event => loadModelFiles([...event.target.files]));
    $('#textureFolderInput').addEventListener('change', event => addTextureFiles([...event.target.files]));
    $('#motionInput').addEventListener('change', event => importMotions([...event.target.files]));
    $('#motionFilter')?.addEventListener('change', event => {
        state.motionFilter = event.target.value || 'all';
        renderMotionLibrary();
    });
    $('#librarySource')?.addEventListener('change', event => {
        localStorage.setItem(LIBRARY_SOURCE_KEY, event.target.value);
        updateLibrarySourceUi();
        renderIdolList();
        renderMotionLibrary();
    });
    $('#libraryR2Base')?.addEventListener('change', event => {
        localStorage.setItem(LIBRARY_R2_KEY, event.target.value.trim());
        updateLibrarySourceUi();
    });
    const updateSecondaryTuning = () => {
        const values = {
            physics: Number(document.getElementById('secondaryPhysicsScale')?.value || 1),
            gravity: Number(document.getElementById('secondaryGravityScale')?.value || 1),
            damping: Number(document.getElementById('secondaryDampingScale')?.value || 1),
            spring: Number(document.getElementById('secondarySpringScale')?.value || 1),
            rootFollow: Number(document.getElementById('secondaryRootFollowScale')?.value || 1),
            chainSkirtRadius: Number(document.getElementById('secondaryChainSkirtRadius')?.value || 1),
            chainJacketRadius: Number(document.getElementById('secondaryChainJacketRadius')?.value || 1),
            chainGap: Number(document.getElementById('secondaryChainGap')?.value || 0) / 1000,
            chainOrder: document.getElementById('secondaryChainOrder')?.value || 'after-collision',
        };
        secondaryMotion.setTuning(values);
        for (const [id, value] of Object.entries({
            secondaryPhysicsScaleValue: values.physics,
            secondaryGravityScaleValue: values.gravity,
            secondaryDampingScaleValue: values.damping,
            secondarySpringScaleValue: values.spring,
            secondaryRootFollowScaleValue: values.rootFollow,
            secondaryChainSkirtRadiusValue: values.chainSkirtRadius,
            secondaryChainJacketRadiusValue: values.chainJacketRadius,
        })) {
            const output = document.getElementById(id);
            if (output) output.textContent = Number(value).toFixed(2);
        }
        const gapOutput = document.getElementById('secondaryChainGapValue');
        if (gapOutput) gapOutput.textContent = `${Math.round(values.chainGap * 1000)} mm`;
    };
    ['secondaryPhysicsScale', 'secondaryGravityScale', 'secondaryDampingScale', 'secondarySpringScale', 'secondaryRootFollowScale', 'secondaryChainSkirtRadius', 'secondaryChainJacketRadius', 'secondaryChainGap'].forEach(id => document.getElementById(id)?.addEventListener('input', updateSecondaryTuning));
    document.getElementById('secondaryChainOrder')?.addEventListener('change', updateSecondaryTuning);
    document.getElementById('secondaryChainResetBtn')?.addEventListener('click', () => {
        const defaults = {
            secondaryChainSkirtRadius: '1',
            secondaryChainJacketRadius: '1',
            secondaryChainGap: '0',
            secondaryChainOrder: 'after-collision',
        };
        for (const [id, value] of Object.entries(defaults)) {
            const input = document.getElementById(id);
            if (input) input.value = value;
        }
        updateSecondaryTuning();
    });
    updateSecondaryTuning();
    bindLightControl('hemiIntensity', hemi, 'intensity', value => {
        state.hemiBaseIntensity = value;
    });
    bindLightControl('keyIntensity', keyLight, 'intensity', value => {
        keyPointLight.intensity = value * (state.materialMode === 'gakumas' ? 0.05 : 0.12);
        updateGakumasUniforms();
    });
    bindLightControl('rimIntensity', rimLight, 'intensity', updateGakumasUniforms);
    $('#keyColor').addEventListener('input', event => { keyLight.color.set(event.target.value); updateGakumasUniforms(); });
    $('#rimColor').addEventListener('input', event => { rimLight.color.set(event.target.value); updateGakumasUniforms(); });
    bindDirectionControl('keyAzimuth', 'keyAzimuthValue', value => updateKeyLightDirection(Number(value), Number($('#keyElevation').value)));
    bindDirectionControl('keyElevation', 'keyElevationValue', value => updateKeyLightDirection(Number($('#keyAzimuth').value), Number(value)));
    bindDirectionControl('shadowAzimuth', 'shadowAzimuthValue', value => updateCharacterShadowDirection(Number(value), Number($('#shadowElevation').value)));
    bindDirectionControl('shadowElevation', 'shadowElevationValue', value => updateCharacterShadowDirection(Number($('#shadowAzimuth').value), Number(value)));
    bindLightControl('shadowStrength', null, null, value => {
        state.shadowStrength = value;
        characterShadowLight.intensity = 0;
        updateGakumasUniforms();
    });
    bindLightControl('gakumasShadowFloor', null, null, value => {
        state.shadowFloor = value;
        updateGakumasUniforms();
    });
    bindLightControl('outlineAlpha', null, null, value => { state.outline.alpha = value; applyOutlineSettings(); });
    bindLightControl('outlineThickness', null, null, value => { state.outline.thickness = value; applyOutlineSettings(); });
    $('#outlineColor').addEventListener('input', event => { state.outline.color = event.target.value; applyOutlineSettings(); });
    $('#renderPreset').addEventListener('change', event => applyRenderPreset(event.target.value));
    $('#gakumasDebugView').addEventListener('change', event => {
        state.gakumasDebugView = Number(event.target.value);
        updateGakumasUniforms();
    });
    $('#gakumasCharacterShadow').addEventListener('change', event => {
        state.gakumasPasses.characterShadow = event.target.checked;
        updateGakumasUniforms();
    });
    $('#gakumasHairCover').addEventListener('change', event => {
        state.gakumasPasses.hairCover = event.target.checked;
    });
    $('#gakumasHairShadow').addEventListener('change', event => {
        state.gakumasPasses.hairShadow = event.target.checked;
        updateGakumasUniforms();
    });
    $('#secondaryMotionToggle')?.addEventListener('change', event => {
        secondaryMotion.enabled = event.target.checked;
        secondaryMotion.update();
        renderSecondaryMotionStatus();
    });
    $('#clothingTraceStartBtn')?.addEventListener('click', () => { secondaryMotion.startClothingTrace({ idolId: state.library.activeIdol, model: state.model?.name || null }); clothingTraceStatus(); showToast('已开始记录衣物二次运动'); });
    $('#clothingTraceExportBtn')?.addEventListener('click', () => { const trace=secondaryMotion.getClothingTrace(); if (!trace) { showToast('还没有衣物诊断记录', true); return; } const blob=new Blob([JSON.stringify(trace,null,2)], {type:'application/json'}); const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=`secondary-motion-${state.library.activeIdol || 'unknown'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); });
    $('#colliderDebugToggle')?.addEventListener('change', event => {
        colliderDebug.enabled = event.target.checked;
        colliderDebug.group.visible = colliderDebug.enabled && !!state.model;
        renderSecondaryMotionStatus();
    });
    bindLightControl('gakumasHairCoverMinimum', null, null, value => {
        state.gakumasPasses.hairCoverMinimum = value;
        updateGakumasUniforms();
    });
    bindLightControl('gakumasHairShadowOffset', null, null, value => {
        state.gakumasPasses.hairShadowOffset = value;
        updateGakumasUniforms();
    });
    bindLightControl('gakumasBloom', null, null, value => lookPass.setBloom({ intensity: value }));
    bindLightControl('gakumasBloomKnee', null, null, value => lookPass.setBloom({ knee: value }));
    bindLightControl('gakumasBloomRadius', null, null, value => lookPass.setBloom({ radius: value }));
    $('#resetCameraBtn').addEventListener('click', resetCamera);
    $('#toggleGridBtn').addEventListener('click', event => {
        grid.visible = !grid.visible;
        event.currentTarget.classList.toggle('is-active', grid.visible);
        event.currentTarget.setAttribute('aria-pressed', String(grid.visible));
    });
    $('#playPauseBtn').addEventListener('click', togglePlayback);
    $('#loopToggle').addEventListener('change', applyLoopMode);
    $('#runCommandBtn').addEventListener('click', runCommandFromEditor);
    $('#runAiCueBtn')?.addEventListener('click', runAiCueFromEditor);
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
    window.addEventListener('resize', resizeRenderer);
    window.addEventListener('beforeunload', revokeObjectUrls);
}

function formatLightValue(inputId, value) {
    const amount = Number(value);
    if (inputId === 'outlineThickness') return amount.toFixed(4);
    return amount.toFixed(2);
}

function bindLightControl(inputId, light, property, onChange = null) {
    const input = $(`#${inputId}`);
    const output = $(`#${inputId}Value`);
    if (!input || !output) return;
    input.addEventListener('input', () => {
        const value = Number(input.value);
        if (light && property) light[property] = value;
        output.textContent = formatLightValue(inputId, value);
        if (onChange) onChange(value);
    });
}

function syncLookBloomControls() {
    const bloom = lookPass.bloom;
    [
        ['gakumasBloom', bloom.intensity],
        ['gakumasBloomKnee', bloom.knee],
        ['gakumasBloomRadius', bloom.radius],
    ].forEach(([id, value]) => {
        const input = $(`#${id}`);
        const output = $(`#${id}Value`);
        if (input) input.value = String(value);
        if (output) output.textContent = formatLightValue(id, value);
    });
}

function bindDirectionControl(inputId, outputId, onChange) {
    const input = $(`#${inputId}`);
    const output = $(`#${outputId}`);
    input.addEventListener('input', () => {
        output.textContent = `${Number(input.value).toFixed(0)}°`;
        onChange(input.value);
    });
}

function setAngleSlider(id, outputId, degrees) {
    const input = $(`#${id}`);
    const output = $(`#${outputId}`);
    if (input) input.value = String(degrees);
    if (output) output.textContent = `${Number(degrees).toFixed(0)}°`;
}

function applyMainLightDirection(azimuth, elevation, source = 'key') {
    const az = Number(azimuth);
    const el = Math.max(-180, Math.min(180, Number(elevation)));
    state.shadowAzimuth = az;
    state.shadowElevation = el;
    const azimuthRad = THREE.MathUtils.degToRad(az);
    const elevationRad = THREE.MathUtils.degToRad(el);
    const direction = new THREE.Vector3(
        Math.sin(azimuthRad) * Math.cos(elevationRad),
        Math.sin(elevationRad),
        Math.cos(azimuthRad) * Math.cos(elevationRad),
    );
    const center = characterShadowFit.center;
    keyLight.target.position.copy(center);
    keyLight.position.copy(center).addScaledVector(direction, 20);
    keyPointLight.position.copy(keyLight.position);
    keyLight.target.updateMatrixWorld();
    keyLight.updateMatrixWorld();
    const shadowDistance = characterShadowFit.radius + 6;
    characterShadowLight.target.position.copy(center);
    characterShadowLight.position.copy(center).addScaledVector(direction, shadowDistance);
    characterShadowLight.target.updateMatrixWorld();
    characterShadowLight.updateMatrixWorld();
    const shadowCamera = characterShadowLight.shadow.camera;
    shadowCamera.left = -characterShadowFit.radius;
    shadowCamera.right = characterShadowFit.radius;
    shadowCamera.top = characterShadowFit.radius;
    shadowCamera.bottom = -characterShadowFit.radius;
    shadowCamera.near = 0.25;
    shadowCamera.far = shadowDistance + characterShadowFit.radius + 4;
    shadowCamera.updateProjectionMatrix();
    characterShadowLight.shadow.updateMatrices(characterShadowLight);
    if (source !== 'key') {
        setAngleSlider('keyAzimuth', 'keyAzimuthValue', az);
        setAngleSlider('keyElevation', 'keyElevationValue', el);
    }
    if (source !== 'shadow') {
        setAngleSlider('shadowAzimuth', 'shadowAzimuthValue', az);
        setAngleSlider('shadowElevation', 'shadowElevationValue', el);
    }
    updateGakumasUniforms();
}

function updateKeyLightDirection(azimuth, elevation) {
    applyMainLightDirection(azimuth, elevation, 'key');
}

function fitCharacterShadowToModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return;
    box.getCenter(characterShadowFit.center);
    characterShadowFit.radius = Math.max(box.getSize(new THREE.Vector3()).length() * 0.55, 4);
    applyMainLightDirection(Number($('#keyAzimuth')?.value ?? state.shadowAzimuth), Number($('#keyElevation')?.value ?? state.shadowElevation), 'key');
}

function updateCharacterShadowDirection(azimuth, elevation) {
    applyMainLightDirection(azimuth, elevation, 'shadow');
}

function updateGakumasUniforms() {
    if (state.materialMode !== 'gakumas' || !state.gakumasUniforms.size) return;
    const direction = state.gakumasLightDirection.copy(keyLight.position).sub(keyLight.target.position).normalize();
    const axisSource = state.gakumasHeadBone || state.model;
    hairCoverStage.update(axisSource, state.gakumasPasses.hairCoverMinimum);
    if (axisSource) state.gakumasHeadRight.setFromMatrixColumn(axisSource.matrixWorld, 0).normalize();
    characterShadowTravel.copy(characterShadowLight.target.position).sub(characterShadowLight.position).normalize();
    const shadowMapSize = characterShadowLight.shadow.mapSize;
    state.gakumasUniforms.forEach(uniforms => {
        uniforms.gkLightDirection.value.copy(direction);
        uniforms.gkLightColor.value.copy(keyLight.color);
        uniforms.gkLightStrength.value = keyLight.intensity;
        uniforms.gkRimColor.value.copy(rimLight.color);
        uniforms.gkRimStrength.value = rimLight.intensity * 0.42;
        uniforms.gkShadowStrength.value = state.shadowStrength;
        uniforms.gkHeadRight.value.copy(state.gakumasHeadRight);
        uniforms.gkDebugView.value = state.gakumasDebugView;
        uniforms.gkCharacterShadowEnabled.value = state.gakumasPasses.characterShadow && characterShadowLight.shadow.map ? 1 : 0;
        uniforms.gkCharacterShadowMap.value = characterShadowLight.shadow.map?.texture || null;
        characterShadowLight.shadow.updateMatrices(characterShadowLight);
        uniforms.gkCharacterShadowMatrix.value.copy(characterShadowLight.shadow.matrix);
        uniforms.gkCharacterShadowLightDir.value.copy(characterShadowTravel);
        uniforms.gkCharacterShadowMapSize.value.set(shadowMapSize.x, shadowMapSize.y);
        uniforms.gkCharacterShadowNormalBias.value = Math.max(0.04, characterShadowFit.radius * 0.006);
        uniforms.gkCharacterShadowConstantBias.value = 0;
        uniforms.gkCharacterShadowRadius.value = 1.25;
        const depthRange = Math.max(characterShadowLight.shadow.camera.far - characterShadowLight.shadow.camera.near, 0.001);
        uniforms.gkCharacterShadowContact.value = Math.max(0.16, characterShadowFit.radius * 0.014) / depthRange;
        hairShadowLightVS.copy(direction).transformDirection(camera.matrixWorldInverse);
        uniforms.gkHairShadowEnabled.value = state.gakumasPasses.hairShadow && hairShadowStage.entries.length ? 1 : 0;
        uniforms.gkHairShadowMap.value = hairShadowStage.map();
        uniforms.gkHairShadowDepth.value = hairShadowStage.depthMap();
        uniforms.gkHairShadowOffset.value = state.gakumasPasses.hairShadowOffset;
        uniforms.gkHairShadowFocus.value = HAIR_SHADOW_FOCUS;
        uniforms.gkHairShadowBias.value = Math.max(HAIR_SHADOW_BIAS, characterShadowFit.radius * 0.0015);
        uniforms.gkHairShadowNear.value = camera.near;
        uniforms.gkHairShadowFar.value = camera.far;
        uniforms.gkHairShadowResolution.value.copy(hairShadowStage.resolution);
        uniforms.gkHairShadowLightVS.value.copy(hairShadowLightVS);
        applyGakumasLookUniforms(uniforms, { ...GAKUMAS_LOOK, shadowFloor: state.shadowFloor });
    });
}

function buildExpressionButtons() {
    const container = $('#expressionGrid');
    container.replaceChildren(...Object.entries(EXPRESSION_PRESETS).map(([id, preset]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `expression-button${id === 'neutral' ? ' is-active' : ''}`;
        button.dataset.expression = id;
        button.innerHTML = `<strong>${preset.label}</strong><small>${id}</small>`;
        button.addEventListener('click', () => applyExpression(id, 1));
        return button;
    }));
}

async function loadModelFiles(files) {
    const pmxFiles = files.filter(file => file.name.toLowerCase().endsWith('.pmx'));
    if (!pmxFiles.length) {
        showToast('所选文件夹中没有找到 PMX 模型', true);
        return;
    }
    if (pmxFiles.length > 1) showToast(`找到 ${pmxFiles.length} 个 PMX，已载入 ${pmxFiles[0].name}`);
    const pmxFile = pmxFiles[0];
    await loadModelFromSource({
        name: pmxFile.name,
        url: createObjectUrl(pmxFile),
        textures: [...files, ...state.textureFiles],
        fileMapFiles: [...files, ...state.textureFiles],
        idolId: '',
    });
}

async function loadModelFromSource({ name, url, textures, fileMapFiles, idolId }) {
    setStatus(`正在载入 ${name}`);
    $('#runtimeBadge').textContent = '载入中';
    state.modelFile = { name };
    const fileMap = fileMapFiles?.length ? buildFileMap(fileMapFiles) : null;
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(resource => (fileMap && resolveLocalResource(resource, fileMap)) || resource);
    const loader = new MMDLoader(manager);

    clearColliderDebug();
    try {
        loader._extractExtension = () => name.toLowerCase().endsWith('.pmd') ? 'pmd' : 'pmx';
        const model = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
        if (state.model) {
            hairCoverStage.dispose();
            state.helper.remove(state.model);
            scene.remove(state.model);
            disposeObject(state.model);
        }
        state.model = model;
        state.library.activeIdol = idolId || identifyLibraryIdol(state.library.config, name)?.id || '';
        state.gakumasHeadBone = null;
        model.traverse(child => {
            if (!state.gakumasHeadBone && child.isBone && /^(?:head|頭|頭部)$/i.test(child.name)) state.gakumasHeadBone = child;
        });
        state.actions.clear();
        state.playlist = [];
        state.playlistIndex = -1;
        state.liveActions = [];
        state.fadingActions = [];
        state.playGeneration += 1;
        state.finishedHandler = null;
        state.pendingFinish = null;
        state.activeClipIds = [];
        state.activeAction = '';
        state.stickyFace = { id: '', intensity: 1 };
        state.lipSync = { bound: {}, track: [], startedAt: 0, active: false, savedMouth: null };
        captureRestPose(model);
        await bindSecondaryMotion();
        model.traverse(child => {
            if (child.isMesh) {
                const shadowRole = classifyShadowRole(child);
                child.userData.shadowRole = shadowRole;
                child.userData.gakumasShadowMaterialMask = [];
                child.castShadow = shadowRole === 'body' || shadowRole === 'hairOuter' || shadowRole === 'clothing';
                child.receiveShadow = shadowRole === 'body' || shadowRole === 'hairOuter' || shadowRole === 'clothing';
                child.material && applyOutlineToMaterial(child.material, child);
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.filter(Boolean).forEach(material => {
                    if ('toneMapped' in material) material.toneMapped = true;
                    if ('lights' in material) material.lights = true;
                    if (child.castShadow) material.shadowSide = THREE.FrontSide;
                    material.needsUpdate = true;
                });
            }
        });
        scene.add(model);
        await loadGakumasTextures(textures || []);
        applyMaterialStyle();
        fitCharacterShadowToModel(model);
        state.helper.add(model, { physics: false });
        frameModel(model);
        renderMorphControls();
        bindLipSyncMorphs();
        renderMotionLibrary();
        renderIdolList();
        $('#emptyState').classList.add('is-hidden');
        $('#modelFileName').textContent = name;
        $('#modelSummary').textContent = `${name} · ${getMorphNames().length} 个 Morph`;
        $('#runtimeBadge').textContent = '模型就绪';
        $('#runtimeBadge').classList.add('is-ready');
        setStatus('模型已载入，可从动作库选择动作', 'ready');
        showToast('PMX 模型载入完成');
        return true;
    } catch (error) {
        console.error('[MMD Stage] model load failed', error);
        $('#runtimeBadge').textContent = '载入失败';
        setStatus('模型载入失败，请检查贴图和控制台', 'error');
        showToast(`模型载入失败：${error.message || '未知错误'}`, true);
        return false;
    }
}

function applyRenderPreset(preset) {
    state.renderPreset = preset;
    state.materialMode = preset === 'gakumas' ? 'gakumas' : 'mmd';
    const settings = {
        mmd: { ...GAKUMAS_LOOK, toneMapping: THREE.NoToneMapping, exposure: 1.0, outlineThickness: 0.004, outlineAlpha: 0.82, outlineColor: '#000000' },
        // Preserve PMX saturation; ACES at the previous low exposure made the
        // actor look gray and milky compared with the MMD preset.
        gakumas: {
            toneMapping: THREE.NoToneMapping, exposure: 1.0,
            key: GAKUMAS_LOOK.key, hemi: GAKUMAS_LOOK.hemi, rim: GAKUMAS_LOOK.rim, shadow: GAKUMAS_LOOK.shadow,
            keyAzimuth: GAKUMAS_LOOK.keyAzimuth, keyElevation: GAKUMAS_LOOK.keyElevation,
            shadowAzimuth: GAKUMAS_LOOK.shadowAzimuth, shadowElevation: GAKUMAS_LOOK.shadowElevation,
            keyColor: GAKUMAS_LOOK.keyColor, rimColor: GAKUMAS_LOOK.rimColor,
            outlineThickness: 0.004, outlineAlpha: 0.82, outlineColor: '#000000',
            characterShadow: true,
        },
        stage: { toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.12, key: 1.45, hemi: 0.34, rim: 0.32, outlineThickness: 0.004, outlineAlpha: 0.82, outlineColor: '#172326' },
        soft: { toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.0, key: 1.05, hemi: 0.62, rim: 0.18, outlineThickness: 0.004, outlineAlpha: 0.82, outlineColor: '#172326' },
    }[preset] || null;
    if (!settings) return;
    renderer.toneMapping = settings.toneMapping;
    renderer.toneMappingExposure = settings.exposure;
    keyLight.intensity = settings.key;
    keyPointLight.intensity = settings.key * (preset === 'gakumas' ? 0.05 : 0.12);
    state.hemiBaseIntensity = settings.hemi;
    hemi.intensity = settings.hemi;
    rimLight.intensity = settings.rim;
    if (Number.isFinite(settings.shadow)) state.shadowStrength = settings.shadow;
    if (Number.isFinite(settings.keyAzimuth) && Number.isFinite(settings.keyElevation)) updateKeyLightDirection(settings.keyAzimuth, settings.keyElevation);
    if (Number.isFinite(settings.shadowAzimuth) && Number.isFinite(settings.shadowElevation)) updateCharacterShadowDirection(settings.shadowAzimuth, settings.shadowElevation);
    characterShadowLight.intensity = 0;
    lookPass.enabled = preset === 'gakumas';
    if (preset === 'gakumas' || preset === 'mmd') {
        lookPass.setBloom({
            intensity: GAKUMAS_LOOK.bloom,
            knee: GAKUMAS_LOOK.bloomKnee,
            radius: GAKUMAS_LOOK.bloomRadius,
        });
        state.shadowFloor = GAKUMAS_LOOK.shadowFloor;
        syncLookBloomControls();
        const floorInput = $('#gakumasShadowFloor');
        const floorOutput = $('#gakumasShadowFloorValue');
        if (floorInput) floorInput.value = String(state.shadowFloor);
        if (floorOutput) floorOutput.textContent = Number(state.shadowFloor).toFixed(2);
    }
    if (preset === 'gakumas' && settings.characterShadow) {
        state.gakumasPasses.characterShadow = true;
        if ($('#gakumasCharacterShadow')) $('#gakumasCharacterShadow').checked = true;
    }
    ['keyIntensity', 'hemiIntensity', 'rimIntensity', 'shadowStrength', 'keyAzimuth', 'keyElevation', 'shadowAzimuth', 'shadowElevation'].forEach(id => {
        const input = $(`#${id}`);
        const output = $(`#${id}Value`);
        if (input && output) {
            const fallback = Number(input.value);
            const value = id === 'keyIntensity' ? settings.key : id === 'hemiIntensity' ? settings.hemi : id === 'rimIntensity' ? settings.rim : id === 'shadowStrength' ? state.shadowStrength : id === 'keyAzimuth' ? (Number.isFinite(settings.keyAzimuth) ? settings.keyAzimuth : fallback) : id === 'keyElevation' ? (Number.isFinite(settings.keyElevation) ? settings.keyElevation : fallback) : id === 'shadowAzimuth' ? (Number.isFinite(settings.shadowAzimuth) ? settings.shadowAzimuth : fallback) : (Number.isFinite(settings.shadowElevation) ? settings.shadowElevation : fallback);
            input.value = String(value);
            output.textContent = /Azimuth|Elevation/.test(id) ? `${Number(value).toFixed(0)}°` : Number(value).toFixed(2);
        }
    });
    if (settings.keyColor) {
        keyLight.color.set(settings.keyColor);
        if ($('#keyColor')) $('#keyColor').value = settings.keyColor;
    }
    if (settings.rimColor) {
        rimLight.color.set(settings.rimColor);
        if ($('#rimColor')) $('#rimColor').value = settings.rimColor;
    }
    if (Number.isFinite(settings.outlineThickness) || Number.isFinite(settings.outlineAlpha) || settings.outlineColor) {
        if (Number.isFinite(settings.outlineThickness)) state.outline.thickness = settings.outlineThickness;
        if (Number.isFinite(settings.outlineAlpha)) state.outline.alpha = settings.outlineAlpha;
        if (settings.outlineColor) state.outline.color = settings.outlineColor;
        const thicknessInput = $('#outlineThickness');
        const thicknessOutput = $('#outlineThicknessValue');
        if (thicknessInput && Number.isFinite(settings.outlineThickness)) {
            thicknessInput.value = String(settings.outlineThickness);
            if (thicknessOutput) thicknessOutput.textContent = formatLightValue('outlineThickness', settings.outlineThickness);
        }
        const alphaInput = $('#outlineAlpha');
        const alphaOutput = $('#outlineAlphaValue');
        if (alphaInput && Number.isFinite(settings.outlineAlpha)) {
            alphaInput.value = String(settings.outlineAlpha);
            if (alphaOutput) alphaOutput.textContent = Number(settings.outlineAlpha).toFixed(2);
        }
        if (settings.outlineColor && $('#outlineColor')) $('#outlineColor').value = settings.outlineColor;
        applyOutlineSettings();
    }
    applyMaterialStyle();
    updateGakumasUniforms();
}

function applyMaterialStyle() {
    $('#gakumasInspector').hidden = state.materialMode !== 'gakumas';
    if (!state.model) return;
    hairCoverStage.dispose();
    hairShadowStage.dispose();
    state.gakumasUniforms.clear();
    state.model.traverse(child => {
        if (!child.isMesh) return;
        let hasCharacterShadowCaster = false;
        child.userData.gakumasShadowMaterialMask = state.materialMode === 'gakumas' ? [] : null;
        applyOutlineToMaterial(child.material, child);
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material, materialIndex) => {
            if (!material?.isMMDToonMaterial) return;
            if (material.map && 'colorSpace' in material.map && THREE.SRGBColorSpace) {
                setTextureColorSpace(material.map, THREE.SRGBColorSpace);
            }
            const selection = selectMaterialTextures(material, state.gakumasTextures);
            material.userData.gakumasSelection = selection;
            const uniforms = material.userData.gakumasUniforms || createGakumasUniforms();
            material.userData.gakumasUniforms = uniforms;
            for (const kind of GAKUMAS_ACTIVE_TEXTURE_KINDS) {
                const uniformName = `gk${kind[0].toUpperCase()}${kind.slice(1)}Map`;
                uniforms[uniformName].value = selection.bindings[kind]?.texture || gakumasFallback(kind);
            }
            uniforms.gkHasShade.value = selection.bindings.shade?.texture ? 1 : 0;
            uniforms.gkHasRamp.value = selection.bindings.ramp?.texture ? 1 : 0;
            uniforms.gkHasHighlight.value = selection.bindings.highlight?.texture ? 1 : 0;
            uniforms.gkRampAddMap.value = selection.bindings.rampAdd?.texture || gakumasFallback('rampAdd');
            state.gakumasUniforms.add(uniforms);
            const role = selection.descriptor.role;
            const actorPass = classifyActorPass(material.name, selection.descriptor.name);
            if (state.materialMode === 'gakumas' && child.userData.gakumasShadowMaterialMask) {
                child.userData.gakumasShadowMaterialMask[materialIndex] = shouldCastCharacterShadow(actorPass);
            }
            uniforms.gkCharacterShadowReceive.value = shouldReceiveCharacterShadow(actorPass) ? 1 : 0;
            uniforms.gkHairShadowReceive.value = shouldReceiveHairShadow(actorPass) ? 1 : 0;
            const rampAddAllowed = ['body', 'bodyAccessory', 'clothing', 'face'].includes(role);
            uniforms.gkHasRampAdd.value = selection.bindings.rampAdd?.texture && rampAddAllowed ? 1 : 0;
            const baseBlending = material.userData.gakumasBaseBlending ?? material.blending;
            material.userData.gakumasBaseBlending = baseBlending;
            const hairTextureName = material.userData?.MMD?.mapFileName || selection.descriptor.name;
            // `transparent` is also used by eye/highlight materials for their
            // blend state. Only the authored alpha texture marks a cutout layer.
            const isEyeLayer = state.materialMode === 'gakumas' && (material.name.toLowerCase() === 'm_eye' || actorPass === 'eye');
            material.userData.gakumasAlphaLayer = false;
            material.userData.gakumasOutlineAlphaExcluded = !isEyeLayer && /(?:_alp|_alpha)(?:\.|_|$)/i.test(hairTextureName);
            material.userData.gakumasOutlineExcluded = /^(?:m_ebs|m_eyelash)$/i.test(material.name.trim());
            material.userData.gakumasEyeLayer = isEyeLayer;
            material.userData.gakumasActorPass = actorPass;
            if (state.materialMode === 'gakumas') {
                const shadowCaster = shouldCastCharacterShadow(actorPass);
                material.receiveShadow = false;
                hasCharacterShadowCaster ||= shadowCaster;
            }
            material.lights = true;
            material.defaultAttributeValues = {
                ...(material.defaultAttributeValues || {}),
                gakumasVertexColor: [0, 0, 0, 0],
            };
            const baseDefines = { ...(material.defines || {}) };
            delete baseDefines.GK_HAIR_COVER;
            material.defines = { ...baseDefines, GK_HAIR: role === 'hair' || actorPass === 'hairHighlight', GK_FACE: role === 'face', GK_EYE: role === 'eye' || role === 'eyeHighlight' };
            material.userData.gakumasBaseTransparent ??= material.transparent;
            material.transparent = material.userData.gakumasBaseTransparent;
            material.blending = baseBlending;
            material.premultipliedAlpha = false;
            material.depthTest = material.userData.gakumasBaseDepthTest ?? material.depthTest;
            material.renderOrder = material.userData.gakumasBaseRenderOrder ?? material.renderOrder;
            material.depthWrite = actorPass !== 'eye' && actorPass !== 'eyeHighlight';
            if (isEyeLayer) {
                material.depthTest = false;
                material.renderOrder = 30;
            }
            material.depthTest = true;
            material.alphaTest = actorPass === 'eye' || actorPass === 'eyeHighlight' ? 0 : 0.33;
            material.side = THREE.FrontSide;
            material.colorWrite = true;
            applyStencilState(material, actorStencilState(material.name, actorPass));
            material.onBeforeCompile = state.materialMode === 'gakumas' ? shader => injectActorShader(shader, uniforms) : () => {};
            material.customProgramCacheKey = () => `gakumas-v2:${state.materialMode}:${role}:look6`;
            material.needsUpdate = true;
            material.visible = true;
            if (state.materialMode === 'gakumas') {
                hairCoverStage.add(child, material, materialIndex, uniforms, hairTextureName);
                if (shouldWriteHairShadow(actorPass)) hairShadowStage.add(child, material, materialIndex);
            }
        });
        if (state.materialMode === 'gakumas') {
            child.castShadow = hasCharacterShadowCaster;
            child.receiveShadow = false;
        }
    });
    updateGakumasUniforms();
    renderGakumasInspector();
}

function applyStencilState(material, state) {
    material.stencilWrite = state.write;
    material.stencilFunc = {
        NeverStencilFunc: THREE.NeverStencilFunc,
        LessStencilFunc: THREE.LessStencilFunc,
        EqualStencilFunc: THREE.EqualStencilFunc,
        LessEqualStencilFunc: THREE.LessEqualStencilFunc,
        GreaterStencilFunc: THREE.GreaterStencilFunc,
        NotEqualStencilFunc: THREE.NotEqualStencilFunc,
        GreaterEqualStencilFunc: THREE.GreaterEqualStencilFunc,
        AlwaysStencilFunc: THREE.AlwaysStencilFunc,
    }[state.func] ?? THREE.AlwaysStencilFunc;
    material.stencilRef = state.ref;
    material.stencilFuncMask = state.readMask;
    material.stencilWriteMask = state.writeMask;
    material.stencilFail = {
        KeepStencilOp: THREE.KeepStencilOp,
        ZeroStencilOp: THREE.ZeroStencilOp,
        ReplaceStencilOp: THREE.ReplaceStencilOp,
    }[state.fail] ?? THREE.KeepStencilOp;
    material.stencilZFail = {
        KeepStencilOp: THREE.KeepStencilOp,
        ZeroStencilOp: THREE.ZeroStencilOp,
        ReplaceStencilOp: THREE.ReplaceStencilOp,
    }[state.zFail] ?? THREE.KeepStencilOp;
    material.stencilZPass = {
        KeepStencilOp: THREE.KeepStencilOp,
        ZeroStencilOp: THREE.ZeroStencilOp,
        ReplaceStencilOp: THREE.ReplaceStencilOp,
    }[state.zPass] ?? THREE.KeepStencilOp;
}

async function loadGakumasTextures(files) {
    const uniqueFiles = new Map();
    for (const file of files) {
        const name = file.name || file.file?.name || '';
        const descriptor = textureDescriptor(name);
        if (!GAKUMAS_TEXTURE_KINDS.includes(descriptor.kind)) continue;
        const key = `${file.url || file.webkitRelativePath || name}:${file.size || 0}:${file.lastModified || 0}`;
        uniqueFiles.set(key, { ...descriptor, file, url: file.url, name });
    }
    const entries = [];
    for (const entry of uniqueFiles.values()) {
        if (GAKUMAS_ACTIVE_TEXTURE_KINDS.includes(entry.kind)) {
            const url = entry.url || createObjectUrl(entry.file);
            try {
                entry.texture = await new THREE.TextureLoader().loadAsync(url);
                entry.texture.colorSpace = textureUsesColorSpace(entry.kind) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
                entry.texture.flipY = false;
                entry.texture.userData.sourceName = entry.name;
                if (entry.kind === 'ramp') {
                    entry.texture.generateMipmaps = false;
                    entry.texture.minFilter = THREE.LinearFilter;
                    entry.texture.magFilter = THREE.LinearFilter;
                    entry.texture.wrapS = THREE.ClampToEdgeWrapping;
                    entry.texture.wrapT = THREE.ClampToEdgeWrapping;
                }
                entry.texture.needsUpdate = true;
            } catch (error) {
                entry.error = String(error.message || error);
                console.warn('[MMD Stage] Gakumas texture load failed', entry.name, error);
            }
        }
        entries.push(entry);
    }
    state.gakumasTextures.forEach(entry => entry.texture?.dispose());
    state.gakumasTextures = entries;
}

function gakumasFallback(kind) {
    if (!state.gakumasFallbacks[kind]) {
        const pixel = kind === 'def' ? [128, 0, 0, 0] : [255, 255, 255, 0];
        const texture = new THREE.DataTexture(new Uint8Array(pixel), 1, 1, THREE.RGBAFormat);
        texture.needsUpdate = true;
        state.gakumasFallbacks[kind] = texture;
    }
    return state.gakumasFallbacks[kind];
}

function createGakumasUniforms() {
    return {
        gkShadeMap: { value: gakumasFallback('shade') },
        gkDefMap: { value: gakumasFallback('def') },
        gkRampMap: { value: gakumasFallback('ramp') },
        gkHighlightMap: { value: gakumasFallback('highlight') },
        gkRampAddMap: { value: gakumasFallback('rampAdd') },
        gkHasShade: { value: 0 },
        gkHasRamp: { value: 0 },
        gkHasHighlight: { value: 0 },
        gkHasRampAdd: { value: 0 },
        gkRampAddColor: { value: new THREE.Color(0xffffff) },
        gkLightDirection: { value: new THREE.Vector3(0.3, 0.6, 0.7) },
        gkLightColor: { value: new THREE.Color(0xffffff) },
        gkLightStrength: { value: GAKUMAS_LOOK.key },
        gkShadowStrength: { value: GAKUMAS_LOOK.shadow },
        gkHeadRight: { value: new THREE.Vector3(1, 0, 0) },
        gkRimDirection: { value: new THREE.Vector3(-0.7, 0.6, 0.3).normalize() },
        gkRimColor: { value: new THREE.Color(GAKUMAS_LOOK.rimColor) },
        gkRimStrength: { value: GAKUMAS_LOOK.rim * 0.42 },
        gkDebugView: { value: 0 },
        gkCharacterShadowMap: { value: null },
        gkCharacterShadowMatrix: { value: new THREE.Matrix4() },
        gkCharacterShadowEnabled: { value: 0 },
        gkCharacterShadowReceive: { value: 1 },
        gkCharacterShadowLightDir: { value: new THREE.Vector3(0, -1, 0) },
        gkCharacterShadowMapSize: { value: new THREE.Vector2(2048, 2048) },
        gkCharacterShadowNormalBias: { value: 0.08 },
        gkCharacterShadowConstantBias: { value: 0 },
        gkCharacterShadowRadius: { value: 1.25 },
        gkCharacterShadowContact: { value: 0.008 },
        gkHairShadowMap: { value: null },
        gkHairShadowDepth: { value: null },
        gkHairShadowEnabled: { value: 0 },
        gkHairShadowReceive: { value: 0 },
        gkHairShadowOffset: { value: 32 },
        gkHairShadowFocus: { value: HAIR_SHADOW_FOCUS },
        gkHairShadowBias: { value: HAIR_SHADOW_BIAS },
        gkHairShadowNear: { value: 0.1 },
        gkHairShadowFar: { value: 1000 },
        gkHairShadowResolution: { value: new THREE.Vector2(1, 1) },
        gkHairShadowLightVS: { value: new THREE.Vector3(0, 1, 0) },
        gkHairFadeParam: { value: new THREE.Vector4(0.15, 4.0, 0.3, 2.0) },
        ...createGakumasLookUniformValues(),
    };
}

function renderGakumasInspector() {
    const rows = [];
    state.model?.traverse(child => {
        if (!child.isMesh) return;
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            const selection = material.userData?.gakumasSelection;
            if (!selection) continue;
            const lines = [`${material.name || '未命名材质'} [${selection.descriptor.role}]`, `基础图：${selection.descriptor.name || '无'}`];
            for (const kind of GAKUMAS_TEXTURE_KINDS) {
                const entry = selection.bindings[kind];
                const pending = !GAKUMAS_ACTIVE_TEXTURE_KINDS.includes(kind);
                const status = selection.ambiguous.includes(kind) ? '存在重名冲突，未绑定' : entry?.error ? '读取失败，使用回退' : entry ? `${entry.name}${pending ? '（已找到，算法待接入）' : ''}` : pending ? '未找到' : '未找到，使用回退';
                lines.push(`${kind}：${status}`);
            }
            rows.push(lines.join('\n'));
        }
    });
    $('#gakumasBindings').textContent = rows.join('\n\n') || '载入模型和贴图后显示逐材质绑定结果。';
    $('#gakumasHeadStatus').textContent = state.gakumasHeadBone ? `脸部朝向跟随：${state.gakumasHeadBone.name}` : '未找到 Head／頭 骨骼；脸部朝向暂跟随模型。';
    if ($('#gakumasCharacterShadow')) $('#gakumasCharacterShadow').checked = state.gakumasPasses.characterShadow;
    if ($('#gakumasHairCover')) $('#gakumasHairCover').checked = state.gakumasPasses.hairCover;
    if ($('#gakumasHairShadow')) $('#gakumasHairShadow').checked = state.gakumasPasses.hairShadow;
    $('#gakumasHairCoverStatus').textContent = `HairCover：${hairCoverStage.entries.reduce((count, entry) => count + entry.groups.length, 0)} 个 m_hir 面组就绪；m_hir+ 高光和其他材质不补绘。`;
    $('#gakumasHairShadowStatus').textContent = `刘海影：${hairShadowStage.entries.reduce((count, entry) => count + entry.groups.length, 0)} 个头发面组写入屏幕深度；只给脸和眼采样，后发深度更大会被丢掉。`;
}

function classifyShadowRole(mesh) {
    const name = `${mesh.name || ''} ${(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => material?.name || '').join(' ')}`.toLowerCase();
    if (/(mouth|oral|teeth|tooth|tongue|inner|inside|眼球|眼白|瞳|口腔|舌|牙|内部)/.test(name)) return 'internal';
    if (/(eye|eyeball|iris|pupil|眼|瞳孔)/.test(name)) return 'eye';
    if (/(face|head|skin|fce|脸|面部)/.test(name)) return 'face';
    if (/(hair|髪|头发|发丝|发片)/.test(name)) return 'hairOuter';
    if (/(cloth|dress|skirt|shirt|sleeve|jacket|衣|服|裙|袖|外套)/.test(name)) return 'clothing';
    return 'body';
}

function applyOutlineToMaterial(material, mesh = null) {
    const materials = Array.isArray(material) ? material : [material];
    materials.filter(Boolean).forEach(item => {
        // MMDLoader already decodes the PMX/PMD edge flag, edge width and
        // edge colour into userData.outlineParameters. Preserve that
        // authoring data before applying the global UI style. In particular,
        // materials with edgeFlag=0 (commonly eyes, mouth interiors and
        // other detail planes) must stay excluded without relying on names.
        if (!item.userData.mmdOutlineParameters && item.userData.outlineParameters) {
            const source = item.userData.outlineParameters;
            item.userData.mmdOutlineParameters = {
                visible: source.visible,
                thickness: source.thickness,
                color: Array.isArray(source.color) ? source.color.slice(0, 3) : undefined,
                alpha: source.alpha,
            };
        }
        const authored = item.userData.mmdOutlineParameters;
        item.userData.gakumasVertexColorEnabled = state.materialMode === 'gakumas' && hasGakumasVertexColorAttribute(mesh);
        const name = `${mesh?.name || ''} ${item.name || ''}`.toLowerCase();
        // Name matching is only a legacy fallback for materials created by
        // non-MMD loaders. PMX metadata has priority and is never overridden.
        const excludedByName = /(?:eye|eyeball|iris|pupil|eyelid|socket|眼球|眼白|瞳孔|眼眶|眼睑|mouth|oral|lip|lipline|teeth|tooth|tongue|口腔|嘴|嘴巴|口|牙|舌|hirco[_-]?col)/i.test(name);
        // Gakumas PMX edge flags are exporter defaults, not the game's outline mask.
        // Let the packed vertex data drive the outline in this preset; retain the
        // material/name exclusions for eye and internal detail planes.
        const visible = state.materialMode === 'gakumas' ? !excludedByName : (authored && authored.visible !== undefined ? authored.visible : !excludedByName);
        item.userData.outlineParameters = {
            visible,
            thickness: state.outline.thickness,
            color: outlineColorArray(state.outline.color),
            alpha: state.outline.alpha,
            keepAlive: true,
        };
    });
}

function applyOutlineSettings() {
    if (!state.model) return;
    state.model.traverse(child => { if (child.isMesh) applyOutlineToMaterial(child.material, child); });
}

function outlineColorArray(hex) {
    const color = new THREE.Color(hex || '#172326');
    return [color.r, color.g, color.b];
}

function addTextureFiles(files) {
    state.textureFiles = files;
    if (state.modelFile) {
        loadModelFiles([state.modelFile, ...files]);
    } else {
        showToast(`已暂存 ${files.length} 个贴图文件，请再选择 PMX 模型。`);
    }
}

function buildFileMap(files) {
    const map = new Map();
    files.forEach(file => {
        const url = createObjectUrl(file);
        const relative = normalizePath(file.webkitRelativePath || file.name);
        const withoutRoot = relative.includes('/') ? relative.slice(relative.indexOf('/') + 1) : relative;
        [relative, withoutRoot, file.name].forEach(key => map.set(normalizePath(key).toLowerCase(), url));
    });
    return map;
}

function resolveLocalResource(rawUrl, fileMap) {
    let path = rawUrl;
    try { path = decodeURIComponent(new URL(rawUrl, window.location.href).pathname); } catch { /* keep raw path */ }
    const normalized = normalizePath(path).replace(/^\/+/, '').toLowerCase();
    const candidates = [normalized, normalized.split('/').pop()];
    for (const [key, value] of fileMap.entries()) {
        if (candidates.includes(key) || normalized.endsWith(`/${key}`)) return value;
    }
    return '';
}

async function importMotions(files) {
    if (!state.model) {
        showToast('请先载入角色模型', true);
        return;
    }
    const motions = files.filter(file => file.name.toLowerCase().endsWith('.vmd'));
    if (!motions.length) return;
    await importMotionEntries(motions.map(file => ({
        id: uniqueActionId(normalizeActionId(file.name) || 'motion'),
        label: file.name.replace(/\.vmd$/i, ''),
        url: createObjectUrl(file),
        name: file.name,
    })));
}

async function importMotionEntries(entries, options = {}) {
    const loader = new MMDLoader();
    let loaded = 0;
    for (const entry of entries) {
        if (state.actions.has(entry.id)) continue;
        try {
            const clip = await new Promise((resolve, reject) => loader.loadAnimation(entry.url, state.model, resolve, undefined, reject));
            clip.name = entry.id;
            const { kind } = classifyClipTracks(clip.tracks.map(track => track.name));
            state.actions.set(entry.id, { id: entry.id, label: entry.label || entry.name?.replace(/\.vmd$/i, '') || entry.id, clip, kind });
            loaded += 1;
        } catch (error) {
            console.error('[MMD Stage] motion load failed', entry.name || entry.id, error);
            showToast(`${entry.name || entry.id} 解析失败`, true);
        }
    }
    rebuildPlaylist();
    if (options.autoplay !== false && !state.activeAction && state.playlist.length) {
        const idle = findIdlePlaylistIndex(state.playlist, state.library.activeIdol);
        playPlaylistIndex(idle >= 0 ? idle : 0, { fade: MOTION_FADE.standing });
    }
    return loaded;
}

function libraryOverrides() {
    return {
        source: $('#librarySource')?.value || localStorage.getItem(LIBRARY_SOURCE_KEY) || state.library.config?.source || 'local',
        r2Base: $('#libraryR2Base')?.value?.trim() || localStorage.getItem(LIBRARY_R2_KEY) || state.library.config?.r2?.baseUrl || '',
    };
}

async function initLibrary() {
    try {
        const [config, map] = await Promise.all([
            fetch('./library.json?v=20260911-idols1', { cache: 'no-store' }).then(response => response.json()),
            fetch('./gakumas-motion-map.json?v=20260911-fktn2').then(response => response.json()),
        ]);
        state.library.config = config;
        state.library.map = map;
        try {
            const status = await fetch('/mmd-dialogue-stage/library/status').then(response => response.ok ? response.json() : null);
            state.library.status = status;
            state.library.indexByPack = new Map(Object.entries(status?.packs || {}).map(([packId, pack]) => [packId, indexMotionFiles(pack.files || [])]));
        } catch (error) {
            console.warn('[MMD Stage] library status unavailable', error);
        }
        updateLibrarySourceUi();
        renderIdolList();
        renderMotionLibrary();
    } catch (error) {
        console.error('[MMD Stage] library init failed', error);
        const list = $('#motionLibraryList');
        if (list) list.innerHTML = '<p class="list-empty">动作库清单读取失败。</p>';
    }
}

function updateLibrarySourceUi() {
    const config = state.library.config;
    if (!config) return;
    const resolved = resolveLibrarySource(config, libraryOverrides());
    if ($('#librarySource')) $('#librarySource').value = resolved.usingR2 ? 'r2' : 'local';
    if ($('#libraryR2Base') && !$('#libraryR2Base').value) $('#libraryR2Base').value = resolved.r2Base;
    const hint = $('#librarySourceHint');
    if (!hint) return;
    const available = (config.idols || []).filter(idol => state.library.status?.packs?.[idol.pack]?.available).length;
    if (resolved.usingR2) {
        hint.textContent = `将从 ${resolved.base} 读取。请把模型和动作按 library.json 里的 r2Prefix 上传到同一公开桶。`;
        return;
    }
    hint.textContent = available
        ? `本机已找到 ${available}/${config.idols.length} 位偶像的资源目录，可从下方选择模型。专用口型与物理以各角色适配情况为准。`
        : `未找到本地偶像资源目录。请确认 library.json 中的路径，或改用 Cloudflare R2。`;
}

function renderIdolList() {
    const container = $('#idolList');
    if (!container) return;
    const idols = state.library.config?.idols || [];
    if (!idols.length) {
        container.innerHTML = '<p class="list-empty">尚未配置偶像。</p>';
        return;
    }
    container.replaceChildren(...idols.map(idol => {
        const pack = state.library.status?.packs?.[idol.pack];
        const card = document.createElement('article');
        card.className = `idol-card${state.library.activeIdol === idol.id ? ' is-active' : ''}`;
        const title = document.createElement('strong');
        title.textContent = idol.name;
        const meta = document.createElement('small');
        meta.textContent = `${idol.outfit} · ${idol.note || '角色模型'}\n${pack?.available === false ? '本机资源未找到' : sourceLabel(libraryOverrides().source)}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'primary-button';
        button.textContent = state.library.activeIdol === idol.id ? '已载入' : '载入角色';
        button.addEventListener('click', () => loadIdol(idol.id));
        card.append(title, meta, button);
        return card;
    }));
}

async function loadIdol(idolId) {
    const idol = state.library.config?.idols?.find(item => item.id === idolId);
    if (!idol) return showToast('未找到该偶像', true);
    const packFiles = state.library.status?.packs?.[idol.pack]?.files || [];
    const textureNames = packFiles
        .filter(name => !idol.textureDir || name.startsWith(`${idol.textureDir}/`) || !name.includes('/'))
        .map(name => name.split('/').pop());
    const assets = idolAssetUrls(idol, state.library.config, textureNames.filter(name => /\.(png|jpe?g|webp)$/i.test(name)), libraryOverrides());
    setStatus(`正在载入 ${idol.name}`);
    const loaded = await loadModelFromSource({
        name: idol.model,
        url: assets.modelUrl,
        textures: assets.textures,
        idolId: idol.id,
    });
    if (loaded) {
        applyRenderPreset('gakumas');
        await ensureIdleMotion({ play: true });
    }
}

async function playLibraryItem(item, options = {}) {
    if (!state.model) {
        showToast('请先载入偶像模型', true);
        return -1;
    }
    const files = motionAssetUrls(item, state.library.config, state.library.indexByPack, libraryOverrides());
    if (!files.length) {
        showToast('没有找到对应的动作文件', true);
        return -1;
    }
    setStatus(`正在载入 ${item.catalog?.title || item.title || item.label}`);
    await ensureIdleMotion({ play: false });
    await importMotionEntries(files.map(file => ({
        id: file.id,
        label: item.label,
        url: file.url,
        name: file.name,
    })), { autoplay: false });
    const key = item.stem || item.key;
    const index = state.playlist.findIndex(entry => entry.key === key || playlistClipIds(entry).some(id => files.some(file => file.id === id)));
    if (index >= 0) playPlaylistIndex(index, options);
    setStatus(`正在播放 ${item.catalog?.title || item.title || item.label}`, 'ready');
    return index;
}

function catalogIdleItem() {
    const character = state.library.activeIdol || '';
    const idles = catalogItems().filter(item => item.catalog?.family === 'idle' || item.family === 'idle');
    return idles.find(item => item.catalog?.character === character || item.character === character)
        || idles.find(item => (item.catalog?.phase || item.phase) === 'lp')
        || idles[0]
        || null;
}

async function ensureIdleMotion({ play = false } = {}) {
    const idle = catalogIdleItem();
    if (!idle || !state.model) return -1;
    const files = motionAssetUrls(idle, state.library.config, state.library.indexByPack, libraryOverrides());
    if (!files.length) return -1;
    await importMotionEntries(files.map(file => ({
        id: file.id,
        label: idle.label,
        url: file.url,
        name: file.name,
    })), { autoplay: false });
    const index = findIdlePlaylistIndex(state.playlist, state.library.activeIdol);
    if (play && index >= 0) playPlaylistIndex(index, { fade: MOTION_FADE.standing });
    return index;
}

function catalogItems() {
    const buckets = state.library.map?.buckets || [];
    return buckets.flatMap(bucket => bucket.families.flatMap(family => family.items.map(item => ({
        ...item,
        key: item.stem,
        catalog: {
            bucket: bucket.id,
            bucketLabel: bucket.label,
            family: family.id,
            familyLabel: family.label,
            title: item.title,
            pairing: item.pairing,
            character: item.character,
            phase: item.phase,
        },
    })))).filter(item => motionMatchesIdol(item, state.library.activeIdol));
}

function renderMotionLibrary() {
    const container = $('#motionLibraryList');
    const filter = $('#motionFilter');
    if (!container) return;
    const items = catalogItems();
    if (filter) {
        const used = new Set(items.map(item => item.catalog.bucket));
        const current = state.motionFilter;
        filter.replaceChildren(new Option('全部分类', 'all'));
        for (const [id, info] of Object.entries(MOTION_BUCKETS)) {
            if (!used.has(id)) continue;
            const count = items.filter(item => item.catalog.bucket === id).length;
            filter.append(new Option(`${info.label} ${count}`, id));
        }
        filter.value = used.has(current) || current === 'all' ? current : 'all';
        state.motionFilter = filter.value;
        filter.disabled = !items.length;
    }
    if (!items.length) {
        container.innerHTML = '<p class="list-empty">动作库清单尚未载入。可先导入外部 VMD。</p>';
        return;
    }
    const visible = state.motionFilter === 'all' ? items : items.filter(item => item.catalog.bucket === state.motionFilter);
    const grouped = new Map();
    for (const item of visible) {
        if (!grouped.has(item.catalog.bucket)) grouped.set(item.catalog.bucket, []);
        grouped.get(item.catalog.bucket).push(item);
    }
    const nodes = [];
    for (const [bucketId, groupItems] of grouped) {
        const heading = document.createElement('p');
        heading.className = 'motion-group';
        heading.textContent = `${MOTION_BUCKETS[bucketId]?.label || groupItems[0].catalog.bucketLabel} ${groupItems.length}`;
        nodes.push(heading);
        for (const item of groupItems) {
            const availability = motionAvailability(item, state.library.indexByPack);
            const loaded = playlistClipIds(item).every(id => !id || state.actions.has(id)) && (item.body || item.face);
            const active = state.playlist[state.playlistIndex]?.key === item.stem;
            const row = document.createElement('div');
            row.className = `motion-item${availability.ready ? ' is-ready' : ' is-missing'}`;
            if (active) row.style.borderColor = 'var(--teal)';
            const button = document.createElement('button');
            button.type = 'button';
            button.title = item.label;
            button.textContent = item.title;
            button.addEventListener('click', () => playLibraryItem(item));
            const tag = document.createElement('code');
            tag.textContent = !availability.ready ? '缺文件' : loaded ? '已载入' : item.pairing === 'paired' ? '配套' : item.pairing === 'faceOnly' ? '仅表情' : '仅动作';
            row.append(button, tag);
            nodes.push(row);
        }
    }
    container.replaceChildren(...nodes);
}

function rebuildPlaylist() {
    const previous = state.playlistIndex >= 0 ? state.playlist[state.playlistIndex]?.key : '';
    state.playlist = sortPlaylistByCatalog(buildPlaylist([...state.actions.values()].map(({ id, label, kind }) => ({ id, label, kind }))));
    state.playlistIndex = previous ? state.playlist.findIndex(item => item.key === previous) : -1;
    renderMotionLibrary();
}

function renderSecondaryMotionStatus() {
    const status = $('#secondaryMotionStatus');
    if (!status) return;
    if (!state.model) {
        status.textContent = '载入模型后绑定跟随、弹簧与碰撞体。';
        return;
    }
    const idol = state.library.config?.idols?.find(item => item.id === state.library.activeIdol);
    if (!supportsSecondaryMotion(idol)) {
        status.textContent = '当前模型尚未配置专用二次运动；未套用琴音的头发、裙摆和碰撞参数。';
        renderColliderAuthoring();
        return;
    }
    const follow = secondaryMotion.bindings.length;
    const springs = secondaryMotion.springs.length;
    const colliders = secondaryMotion.colliders.length;
    const missing = secondaryMotion.missing;
    status.textContent = missing.length
        ? `二次动作已绑定跟随 ${follow}、弹簧 ${springs}、碰撞 ${colliders}，未找到 ${missing.length} 项`
        : `二次动作已绑定 ${follow} 个跟随、${springs} 个弹簧、${colliders} 个碰撞体。游戏半径为米，当前骨架缩放 ${secondaryMotion.scale.toFixed(2)}。`;
    renderColliderAuthoring();
}

function colliderDebugMaterial(color, opacity) {
    return new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity, depthWrite: false });
}

function clearColliderDebug() {
    resizeDebugPool(colliderDebug.staticMeshes, 0, 0, 0);
    resizeDebugPool(colliderDebug.particleMeshes, 0, 0, 0);
    colliderDebug.group.visible = false;
}

function resizeDebugPool(pool, count, color, opacity) {
    while (pool.length > count) {
        const mesh = pool.pop();
        colliderDebug.group.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
    }
    while (pool.length < count) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), colliderDebugMaterial(color, opacity));
        mesh.frustumCulled = false;
        colliderDebug.group.add(mesh);
        pool.push(mesh);
    }
}

function fitDebugSphere(mesh, center, radius) {
    mesh.visible = radius > 1e-5;
    if (!mesh.visible) return;
    if (mesh.userData.debugKind !== 'sphere') {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.SphereGeometry(1, 12, 8);
        mesh.userData.debugKind = 'sphere';
        mesh.userData.debugLength = 0;
        mesh.userData.debugRadius = 1;
    }
    mesh.position.set(center[0], center[1], center[2]);
    mesh.scale.setScalar(Math.max(radius, 0.001));
    mesh.quaternion.identity();
}

function fitDebugCapsule(mesh, start, end, radius) {
    const sx = start[0];
    const sy = start[1];
    const sz = start[2];
    const length = Math.hypot(end[0] - sx, end[1] - sy, end[2] - sz);
    if (length < 1e-4) return fitDebugSphere(mesh, start, radius);
    mesh.visible = true;
    if (mesh.userData.debugKind !== 'capsule' || Math.abs((mesh.userData.debugLength || 0) - length) > 0.03 || Math.abs((mesh.userData.debugRadius || 0) - radius) > 0.01) {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.CapsuleGeometry(Math.max(radius, 0.001), length, 3, 8);
        mesh.userData.debugKind = 'capsule';
        mesh.userData.debugLength = length;
        mesh.userData.debugRadius = radius;
    }
    mesh.position.set((sx + end[0]) / 2, (sy + end[1]) / 2, (sz + end[2]) / 2);
    colliderDebugDir.set(end[0] - sx, end[1] - sy, end[2] - sz).normalize();
    mesh.quaternion.setFromUnitVectors(colliderDebugUp, colliderDebugDir);
}

function updateColliderDebug() {
    colliderDebug.group.visible = colliderDebug.enabled && !!state.model;
    if (!colliderDebug.enabled || !state.model) return;
    const debug = secondaryMotion.debugState();
    resizeDebugPool(colliderDebug.staticMeshes, debug.colliders.length, 0x2bb5a8, 0.8);
    debug.colliders.forEach((shape, index) => {
        const mesh = colliderDebug.staticMeshes[index];
        if (shape.kind === 'capsule') fitDebugCapsule(mesh, shape.start, shape.end, Math.max(shape.radiusA, shape.radiusB));
        else fitDebugSphere(mesh, shape.start, shape.radiusA);
    });
    resizeDebugPool(colliderDebug.particleMeshes, debug.particles.length, 0xef765f, 0.45);
    debug.particles.forEach((particle, index) => fitDebugSphere(colliderDebug.particleMeshes[index], particle.position, particle.radius));
}

function renderColliderAuthoring() {
    const panel = $('#colliderAuthoring');
    if (!panel) return;
    if (!state.model || !secondaryMotion.colliders.length) {
        panel.textContent = '载入模型后列出游戏原始碰撞半径（米）。';
        return;
    }
    const lines = [
        `下列半径直接来自身体 AssetBundle 的 ActorSwingStaticBone，单位是米。`,
        `偏移已按 Unity 静止姿态烘焙到 PMX 本地，不再在舞台上猜骨骼轴向。`,
        `舞台当前骨架缩放 ${secondaryMotion.scale.toFixed(2)}。头发只按身体体积推开，不再把粒子半径加进去。`,
        '',
    ];
    for (const { record } of secondaryMotion.colliders) {
        const cm = (record.radiusA * 100).toFixed(1);
        const kind = record.kind === 'capsule' || record.type === 1 ? '胶囊' : '球体';
        lines.push(`${record.bone}  ${kind}  mask ${record.collisionMask}  半径 ${cm}cm`);
    }
    panel.textContent = lines.join('\n');
}

async function bindSecondaryMotion() {
    const generation = ++secondaryMotionBindGeneration;
    const idolId = state.library.activeIdol;
    const idol = state.library.config?.idols?.find(item => item.id === idolId);
    secondaryMotion.bind([]);
    updateColliderDebug();
    if (!supportsSecondaryMotion(idol)) {
        renderSecondaryMotionStatus();
        return;
    }
    const table = await secondaryMotionReady(idolId);
    if (generation !== secondaryMotionBindGeneration || state.library.activeIdol !== idolId || !state.model) return;
    if (!table) {
        renderSecondaryMotionStatus();
        showToast('二次动作参数表载入失败，头发送裙跟随暂不可用', true);
        return;
    }
    if (!state.restPose) return;
    secondaryMotion.table = table;
    secondaryMotion.startClothingTrace({ idolId, model: state.model?.name || null, source: "secondary-motion-profile" });
    secondaryMotion.bind(state.restPose);
    renderSecondaryMotionStatus();
    updateColliderDebug();
    if (secondaryMotion.missing.length) {
        const preview = secondaryMotion.missing.slice(0, 6).join('、');
        showToast(`二次动作未绑定 ${secondaryMotion.missing.length} 项：${preview}${secondaryMotion.missing.length > 6 ? ' 等' : ''}`, true);
    }
}

function captureRestPose(model) {
    const bones = model?.skeleton?.bones ?? [];
    state.restPose = bones.map(bone => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
    }));
}

function playAction(id) {
    const wanted = normalizeActionId(id);
    const index = state.playlist.findIndex(item => item.key === wanted || playlistClipIds(item).includes(wanted));
    if (index < 0) {
        if (id) showToast(`动作库中没有“${id}”`, true);
        return false;
    }
    return playPlaylistIndex(index);
}

function ensureMixer() {
    if (!state.model) return null;
    if (!state.helper.objects.get(state.model)) {
        state.helper.add(state.model, { physics: false });
    }
    const objects = state.helper.objects.get(state.model);
    if (!objects.mixer) {
        objects.mixer = new THREE.AnimationMixer(state.model);
        objects.mixer.addEventListener('loop', event => {
            const tracks = event.action.getClip()?.tracks || [];
            if (tracks.length > 0 && !String(tracks[0].name).startsWith('.bones')) return;
            objects.looped = true;
        });
    }
    return objects.mixer;
}

function clipKind(clipId) {
    return state.actions.get(clipId)?.kind || '';
}

function resolvePlayClipIds(item, fromItem, options = {}) {
    const ids = playlistClipIds(item);
    if (options.skipFace) return ids.filter(id => clipKind(id) === 'body' || id === item.body);
    if (options.keepBody) {
        const bodyId = item.body || fromItem?.body || state.activeClipIds.find(id => clipKind(id) === 'body');
        return [...new Set([bodyId, item.face].filter(Boolean))];
    }
    if (!item?.face || item.body || !canKeepBodyForFace(fromItem)) return ids;
    const bodyIds = (fromItem ? playlistClipIds(fromItem) : state.activeClipIds)
        .filter(id => clipKind(id) === 'body' || id === fromItem?.body);
    return [...new Set([...bodyIds, item.face])];
}

function harvestFadedActions() {
    if (!state.fadingActions.length) return;
    const next = [];
    for (const action of state.fadingActions) {
        if (state.liveActions.includes(action)) continue;
        // Held LoopOnce clips are paused by clampWhenFinished. isRunning() is
        // false then, but they must keep feeding the last pose until weight hits 0.
        if (action.enabled && action.getEffectiveWeight() > 0.01) next.push(action);
        else action.stop();
    }
    state.fadingActions = next;
}

function clearFinishedHandler(mixer) {
    if (mixer && state.finishedHandler) mixer.removeEventListener('finished', state.finishedHandler);
    state.finishedHandler = null;
}

function playPlaylistIndex(index, options = {}) {
    const item = state.playlist[index];
    if (!item || !state.model) return false;
    const fromItem = state.playlistIndex >= 0 ? state.playlist[state.playlistIndex] : null;
    const clipIds = resolvePlayClipIds(item, fromItem, options);
    const clips = clipIds.map(clipId => ({ id: clipId, clip: state.actions.get(clipId)?.clip, kind: clipKind(clipId) })).filter(entry => entry.clip);
    if (!clips.length) return false;

    const mixer = ensureMixer();
    if (!mixer) return false;
    clearFinishedHandler(mixer);
    mixer.timeScale = 1;

    const sameClip = fromItem && fromItem.key === item.key && !options.forceFade;
    const bodyFade = sameClip ? 0 : (options.fade ?? fadeDurationForTransition(fromItem, item));
    const loop = shouldLoopMotion(item, $('#loopToggle')?.checked);
    const nextActions = clips.map(({ clip }) => mixer.clipAction(clip));
    const keep = new Set(nextActions);
    const outgoing = state.liveActions.filter(action => !keep.has(action));
    const fadeIncoming = bodyFade > 0 && !sameClip;

    for (const action of outgoing) {
        action.enabled = true;
        if (bodyFade > 0) {
            // Keep a held last frame paused. Unpausing LoopOnce re-finishes on
            // the next tick and used to make harvest stop() the pose into T-pose.
            action.fadeOut(bodyFade);
            if (!state.fadingActions.includes(action)) state.fadingActions.push(action);
        }
    }

    for (const { clip, kind } of clips) {
        const action = mixer.clipAction(clip);
        const fade = fadeDurationForClip(kind, bodyFade);
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        action.clampWhenFinished = true;
        action.enabled = true;
        const isKept = state.liveActions.includes(action);
        if (sameClip || !isKept) action.reset();
        action.setEffectiveWeight(1);
        action.play();
        // Crossfade 0→1 against the outgoing last pose. Do not start at weight 1
        // or VMD frame 0 (often T-pose) replaces the hold immediately.
        if (fadeIncoming && fade > 0 && !isKept) action.fadeIn(fade);
    }

    state.helper.update(0);
    if (bodyFade <= 0) {
        for (const action of outgoing) action.stop();
    }
    state.liveActions = nextActions;
    state.playlistIndex = index;
    state.activeAction = item.key;
    state.activeClipIds = clipIds;
    state.playing = true;
    state.playGeneration += 1;

    if (!loop) attachClipFinished(mixer, clips.map(entry => entry.clip), item, state.playGeneration);

    const faceAction = item.face ? state.actions.get(item.face) : null;
    if (faceAction && classifyClipTracks(faceAction.clip.tracks.map(track => track.name)).morphs === 0) {
        showToast('表情没有绑定到当前模型的 Morph，请换用带嘴部短名的面部 PMX', true);
    }
    $('#nowPlaying').textContent = playlistTitle(item);
    updatePlaybackUi();
    renderMotionLibrary();
    return true;
}

function attachClipFinished(mixer, clips, item, generation) {
    const longest = clips.reduce((left, right) => (right.duration > left.duration ? right : left));
    const handler = event => {
        if (state.playGeneration !== generation || event.action.getClip() !== longest) return;
        clearFinishedHandler(mixer);
        state.pendingFinish = { item, generation };
    };
    state.finishedHandler = handler;
    mixer.addEventListener('finished', handler);
}

function flushPendingFinish() {
    const pending = state.pendingFinish;
    if (!pending || pending.generation !== state.playGeneration) {
        state.pendingFinish = null;
        return;
    }
    state.pendingFinish = null;
    finishCurrentMotion();
}

function finishCurrentMotion() {
    const mixer = state.helper.objects.get(state.model)?.mixer;
    if (mixer) mixer.timeScale = 0;
    state.playing = false;
    updatePlaybackUi();
}

function playlistTitle(item) {
    const title = item.catalog?.title || item.label;
    const parts = [];
    if (item.body) parts.push('动作');
    if (item.face) parts.push('表情');
    return parts.length > 1 ? `${title}（${parts.join(' + ')}）` : title;
}

function applyExpression(id, intensity = 1, explicitMorphs = {}) {
    if (!state.model) {
        showToast('请先载入 PMX 模型', true);
        return false;
    }
    const influences = state.model.morphTargetInfluences;
    if (!influences) return false;
    influences.fill(0);
    const names = getMorphNames();
    const preset = EXPRESSION_PRESETS[id];
    let matched = false;
    if (preset && id !== 'neutral') {
        const morphName = findPresetMorph(names, preset);
        if (morphName) {
            influences[state.model.morphTargetDictionary[morphName]] = preset.weight * intensity;
            matched = true;
        }
    }
    Object.entries(explicitMorphs).forEach(([name, weight]) => {
        const index = state.model.morphTargetDictionary?.[name];
        if (Number.isInteger(index)) {
            influences[index] = weight * intensity;
            matched = true;
        }
    });
    state.activeExpression = id || 'custom';
    document.querySelectorAll('.expression-button').forEach(button => button.classList.toggle('is-active', button.dataset.expression === id));
    syncMorphControls();
    if (matched || id === 'neutral') return true;
    if (id) {
        playFaceCue(id, { keepBody: true }).then(played => {
            if (!played) showToast(`模型中没有匹配“${id}”的 Morph，动作库也没有对应表情`, true);
        });
        return true;
    }
    return false;
}

function bindLipSyncMorphs() {
    const idol = state.library.config?.idols?.find(item => item.id === state.library.activeIdol);
    state.lipSync.bound = bindVisemeMorphs(getMorphNames(), idol?.visemes);
    if (allVisemeBindingTargets(state.lipSync.bound).length) return;
    const numbered = getMorphNames().some(name => /^(?:b_mouth\.)?mouth_\d+$/i.test(name));
    showToast(numbered
        ? '当前模型嘴部是 mouth_001 这类编号，还没有 viseme 对应表，口型估算不会动嘴'
        : '当前模型没有匹配的口型 Morph，文本口型估算不会动嘴', true);
}

function startLipSync(track) {
    state.lipSync.track = Array.isArray(track) ? track : [];
    state.lipSync.startedAt = performance.now();
    state.lipSync.active = state.lipSync.track.length > 0;
    state.lipSync.savedMouth = null;
}

function applyPerformanceOverlays() {
    const influences = state.model?.morphTargetInfluences;
    const dictionary = state.model?.morphTargetDictionary;
    if (!influences || !dictionary) return;
    const bound = state.lipSync.bound || {};
    const faceId = state.stickyFace?.id;
    if (shouldClearFacialNoise(faceId)) {
        for (const name of getMorphNames()) {
            if (!isFacialNoiseMorph(name)) continue;
            const noiseIndex = dictionary[name];
            if (Number.isInteger(noiseIndex)) influences[noiseIndex] = 0;
        }
        const preset = EXPRESSION_PRESETS[faceId];
        const morphName = findPresetMorph(getMorphNames(), preset);
        const index = morphName ? dictionary[morphName] : undefined;
        if (Number.isInteger(index)) influences[index] = (preset?.weight || 1) * (state.stickyFace.intensity || 1);
    }
    if (!state.lipSync.active) return;
    if (!state.lipSync.savedMouth) {
        state.lipSync.savedMouth = snapshotVisemeInfluences(influences, dictionary, bound);
    }
    const elapsed = (performance.now() - state.lipSync.startedAt) / 1000;
    const last = state.lipSync.track[state.lipSync.track.length - 1];
    if (last && elapsed > last.t + (last.duration || 0)) {
        restoreVisemeInfluences(influences, dictionary, state.lipSync.savedMouth);
        state.lipSync.active = false;
        state.lipSync.savedMouth = null;
        return;
    }
    for (const target of allVisemeBindingTargets(bound)) {
        const index = dictionary[target.name];
        if (Number.isInteger(index)) influences[index] = 0;
    }
    const weights = visemeWeightAt(state.lipSync.track, elapsed);
    Object.entries(weights).forEach(([viseme, weight]) => {
        if (weight <= 0) return;
        visemeBindingTargets(bound, viseme).forEach(target => {
            const index = dictionary[target.name];
            if (!Number.isInteger(index)) return;
            const next = weight * (target.weight || 1);
            influences[index] = Math.max(influences[index] || 0, next);
        });
    });
}

function cuePickKey(item) {
    return String(item?.stem || item?.key || item?.body || item?.face || '');
}

async function playGestureCue(family, options = {}) {
    const catalog = catalogItems();
    const pickOptions = { ...options, avoidKey: state.lastCuePick.gestureKey };
    const catalogIndex = findGesturePlaylistIndex(catalog, family, state.library.activeIdol, pickOptions);
    if (catalogIndex >= 0) {
        state.lastCuePick.gestureKey = cuePickKey(catalog[catalogIndex]);
        return (await playLibraryItem(catalog[catalogIndex], options)) >= 0;
    }
    const loadedIndex = findGesturePlaylistIndex(state.playlist, family, state.library.activeIdol, pickOptions);
    if (loadedIndex >= 0) {
        state.lastCuePick.gestureKey = cuePickKey(state.playlist[loadedIndex]);
        playPlaylistIndex(loadedIndex, options);
        return true;
    }
    return false;
}

async function playFaceCue(faceId, options = {}) {
    const catalog = catalogItems();
    const pickOptions = { ...options, avoidKey: state.lastCuePick.faceKey };
    const catalogIndex = findFacePlaylistIndex(catalog, faceId, pickOptions);
    if (catalogIndex >= 0) {
        state.lastCuePick.faceKey = cuePickKey(catalog[catalogIndex]);
        return (await playLibraryItem(catalog[catalogIndex], options)) >= 0;
    }
    const loadedIndex = findFacePlaylistIndex(state.playlist, faceId, pickOptions);
    if (loadedIndex >= 0) {
        state.lastCuePick.faceKey = cuePickKey(state.playlist[loadedIndex]);
        playPlaylistIndex(loadedIndex, options);
        return true;
    }
    return false;
}

function runAiCueFromEditor() {
    return playAiCueFromEditor();
}

async function playAiCueFromEditor() {
    try {
        const cue = parseAiCue($('#aiCueInput')?.value || '');
        if (cue.error) throw new Error(cue.error);
        cue.warnings.forEach(warning => showToast(warning, true));
        if (cue.face) {
            state.activeExpression = cue.face;
            document.querySelectorAll('.expression-button').forEach(button => button.classList.toggle('is-active', button.dataset.expression === cue.face));
        }
        const estimateLips = $('#aiLipSyncToggle')?.checked !== false;
        const track = cue.visemes.length
            ? cue.visemes
            : (estimateLips && cue.text ? estimateVisemeTrack(cue.text) : []);
        startLipSync(track);
        let gesturePlayed = !cue.gesture;
        if (cue.gesture) {
            gesturePlayed = await playGestureCue(cue.gesture, {
                skipFace: cue.skipFace,
                preferPairing: cue.skipFace ? 'bodyOnly' : 'paired',
            });
        }
        let facePlayed = !cue.face;
        if (cue.face) {
            facePlayed = await playFaceCue(cue.face, { keepBody: true });
            state.stickyFace = facePlayed ? { id: '', intensity: 1 } : { id: cue.face, intensity: 1 };
        }
        const faceText = cue.face ? faceCueLabel(cue.face) : '';
        const gestureText = cue.gesture ? gestureCueLabel(cue.gesture) : '';
        if ((cue.gesture && !gesturePlayed) || (cue.face && !facePlayed)) {
            showToast(`已识别${faceText ? `表情「${faceText}」` : ''}${faceText && gestureText ? '、' : ''}${gestureText ? `动作「${gestureText}」` : ''}，但动作库没有对应${cue.face && !facePlayed ? '表情' : '动作'}文件`);
            return;
        }
        const parts = [
            cue.pairing === 'paired' && gestureText && `成套「${gestureText}」`,
            faceText && `表情「${faceText}」`,
            cue.pairing !== 'paired' && gestureText && `动作「${gestureText}」`,
            cue.text && '口型估算',
        ].filter(Boolean);
        showToast(parts.length ? `已识别：${parts.join('，')}` : '没有识别到关键词');
    } catch (error) {
        showToast(error.message, true);
    }
}

function runCommandFromEditor() {
    try {
        const command = parsePerformanceCommand($('#commandInput').value);
        if (command.expression || Object.keys(command.morphs).length) {
            const expression = command.expression || 'custom';
            if (command.expression && !EXPRESSION_PRESETS[command.expression]) {
                throw new Error(`未知表情预设：${command.expression}`);
            }
            applyExpression(expression, command.intensity, command.morphs);
        }
        if (command.action) playAction(command.action);
        showToast('表演指令已执行');
    } catch (error) {
        showToast(error.message, true);
    }
}

function renderMorphControls() {
    const container = $('#morphList');
    const names = getMorphNames();
    $('#morphCount').textContent = `${names.length} 项`;
    if (!names.length) {
        container.innerHTML = '<p class="list-empty">这个模型没有可用的 Morph。</p>';
        return;
    }
    container.replaceChildren(...names.map(name => {
        const index = state.model.morphTargetDictionary[name];
        const row = document.createElement('label');
        row.className = 'morph-row';
        row.innerHTML = `<span title="${escapeHtml(name)}">${escapeHtml(name)}</span><input type="range" min="0" max="1" step="0.01" value="0" data-morph-index="${index}"><output>0.00</output>`;
        const input = row.querySelector('input');
        input.addEventListener('input', () => {
            state.model.morphTargetInfluences[index] = Number(input.value);
            row.querySelector('output').value = Number(input.value).toFixed(2);
            state.activeExpression = 'custom';
            document.querySelectorAll('.expression-button').forEach(button => button.classList.remove('is-active'));
        });
        return row;
    }));
}

function syncMorphControls() {
    document.querySelectorAll('[data-morph-index]').forEach(input => {
        const weight = state.model?.morphTargetInfluences?.[Number(input.dataset.morphIndex)] || 0;
        input.value = String(weight);
        input.nextElementSibling.value = weight.toFixed(2);
    });
}

function togglePlayback() {
    if (state.playlistIndex < 0) {
        if (!state.playlist.length) return showToast('请先从动作库选择动作', true);
        playPlaylistIndex(0);
        return;
    }
    const mixer = state.helper.objects.get(state.model)?.mixer;
    if (!mixer) return;
    state.playing = !state.playing;
    mixer.timeScale = state.playing ? 1 : 0;
    updatePlaybackUi();
}

function applyLoopMode() {
    const item = state.playlistIndex >= 0 ? state.playlist[state.playlistIndex] : null;
    const mixer = state.helper.objects.get(state.model)?.mixer;
    if (!item || !mixer || !state.liveActions.length) return;
    const loop = shouldLoopMotion(item, $('#loopToggle').checked);
    for (const action of state.liveActions) {
        action.paused = false;
        action.enabled = true;
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        action.clampWhenFinished = true;
    }
    mixer.timeScale = 1;
    clearFinishedHandler(mixer);
    if (!loop) {
        state.playGeneration += 1;
        attachClipFinished(mixer, state.liveActions.map(action => action.getClip()).filter(Boolean), item, state.playGeneration);
    }
}

function updatePlaybackUi() {
    $('#playPauseBtn').classList.toggle('is-playing', state.playing);
    $('#playPauseBtn').setAttribute('aria-label', state.playing ? '暂停动作' : '播放动作');
}

function frameModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = Math.max(size.y, 1);
    controls.target.copy(center);
    camera.position.set(center.x + height * 0.12, center.y + height * 0.04, center.z + height * 1.35);
    camera.near = Math.max(0.01, height / 100);
    camera.far = height * 100;
    camera.updateProjectionMatrix();
    controls.update();
}

function resetCamera() {
    if (state.model) return frameModel(state.model);
    camera.position.set(1.2, 10, 28);
    controls.target.set(0, 9, 0);
    controls.update();
}

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    keyLight.target.updateMatrixWorld();
    keyLight.updateMatrixWorld();
    if (state.model) {
        state.helper.update(delta);
        harvestFadedActions();
        flushPendingFinish();
        applyPerformanceOverlays();
        secondaryMotion.update(delta);
        state.model.updateMatrixWorld(true);
        updateColliderDebug();
    }
    controls.update();
    resizeRenderer();
    if (state.materialMode === 'gakumas') {
        state.model?.updateMatrixWorld(true);
        camera.updateMatrixWorld();
        if (state.gakumasPasses.hairShadow) hairShadowStage.capture(renderer, scene, camera);
        updateGakumasUniforms();
    }
    const draw = () => hairCoverStage.renderFrame(renderer, outlineEffect, scene, camera, state.materialMode === 'gakumas' && state.gakumasPasses.hairCover);
    if (lookPass.enabled) lookPass.render(draw);
    else draw();
}

function resizeRenderer() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
}

function getMorphNames() {
    return Object.keys(state.model?.morphTargetDictionary || {});
}

function selectTab(id) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.tab === id));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('is-active', panel.dataset.panel === id));
}

function setStatus(text, type = '') {
    $('#statusText').textContent = text;
    $('#statusDot').className = `status-dot${type ? ` is-${type}` : ''}`;
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = `toast${isError ? ' is-error' : ''}`;
    toast.textContent = message;
    $('#toastStack').append(toast);
    window.setTimeout(() => toast.remove(), 3200);
}

function createObjectUrl(file) {
    const url = URL.createObjectURL(file);
    state.objectUrls.push(url);
    return url;
}

function revokeObjectUrls() {
    state.objectUrls.forEach(url => URL.revokeObjectURL(url));
    state.objectUrls.length = 0;
}

function uniqueActionId(base) {
    let id = base;
    let suffix = 2;
    while (state.actions.has(id)) id = `${base}-${suffix++}`;
    return id;
}

function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function disposeObject(object) {
    object.traverse(child => {
        child.geometry?.dispose?.();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.filter(Boolean).forEach(material => {
            Object.values(material).forEach(value => value?.isTexture && value.dispose());
            material.dispose?.();
        });
    });
}











