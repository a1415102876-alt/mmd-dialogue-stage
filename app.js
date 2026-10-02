import * as THREE from 'three';
import { bindGlbMorphTracks } from './glb-morph-tracks.js?v=20260929-face-primitives-v1';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js?v=20260909-outline1';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js?v=20260909-outline1';
import { EXPRESSION_PRESETS, MOTION_BUCKETS, MOTION_FADE, buildPlaylist, classifyClipTracks, findPresetMorph, indexMotionFiles, normalizeActionId, parsePerformanceCommand, playlistClipIds, sortPlaylistByCatalog, canKeepBodyForFace, fadeDurationForClip, fadeDurationForTransition, findIdlePlaylistIndex, findFacePlaylistIndex, findGesturePlaylistIndex, shouldLoopMotion } from './core.js?v=20260929-glb-direct-track-classifier-v2';
import { LIBRARY_R2_KEY, LIBRARY_SOURCE_KEY, idolAssetUrls, libraryFileUrl, motionAssetUrls, motionAvailability, resolveLibrarySource, selectIdolModel, sourceLabel } from './library-client.js?v=20261002-idol-glb';
import { GAKUMAS_TEXTURE_KINDS, GAKUMAS_ACTIVE_TEXTURE_KINDS, selectMaterialTextures, textureDescriptor, textureUsesColorSpace, setTextureColorSpace } from './gakumas-materials.js?v=20260929-glb-highlight-semantic-v2';
import { injectActorShader } from './gakumas-shader.js?v=20261003-hair-cover-fix-v10';
import { actorStencilState, classifyActorPass, placeCharacterShadowLight, shouldCastCharacterShadow, shouldReceiveCharacterShadow } from './gakumas-passes.js?v=20261003-hair-cover-fix-v10';
import { HairCoverStage } from './gakumas-hair-cover.js?v=20261003-hair-cover-fix-v10';
import { GakumasSceneStage } from './gakumas-scene.js?v=20261002-scene-lit-v7';
import { GakumasPostPass } from './gakumas-post.js?v=20261002-scene-lit-v9';
import { GAKUMAS_LOOK, GakumasLookPass, applyGakumasLookUniforms, createGakumasLookUniformValues } from './gakumas-look.js?v=20261002-rim-v1';
import { hasGakumasVertexColorAttribute } from './gakumas-outline.js?v=20260929-packed-color';
import { SecondaryMotion, applyHairRestRotationRebase, rebaseHairAnimationTracks, refreshRestInverseBinds } from './gakumas-secondary-motion.js?v=20261002-secondary-motion-v42-lilia-skirt-child-chain';
import { buildStageBoneTraceFrame, createStageBoneTrace } from './stage-bone-trace.js?v=20260927-stage-bone-trace-v1';
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
    modelFormat: '',
    gltf: null,
    animationTarget: null,
    animationMixer: null,
    skeletonBones: [],
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
    gakumasPasses: { characterShadow: true, hairCover: true, hairCoverMinimum: 0.35 },
    outline: { color: '#000000', alpha: 0.82, thickness: 0.004 },
};

// UnityGLTF exports this actor in Unity world units while the recovered
// secondary-motion table and the PMX stage use the authored stage unit. The
// HSKI Unity export is approximately 125 times smaller than that stage.
const GLB_STAGE_SCALE = 12.5;
const clock = new THREE.Clock();
const hairCoverStage = new HairCoverStage();
const secondaryMotion = new SecondaryMotion();
const colliderDebug = {
    enabled: false,
    selected: 'all',
    group: new THREE.Group(),
    staticMeshes: [],
    particleMeshes: [],
};
colliderDebug.group.visible = false;
const colliderDebugUp = new THREE.Vector3(0, 1, 0);
const colliderDebugDir = new THREE.Vector3();
const secondaryMotionTables = new Map();
const clothingTraceStatus = () => { const node=$('clothingTraceStatus'); if (node) { const s=secondaryMotion.getClothingTraceStatus(); node.textContent=s.active ? `衣物诊断：${s.ticks}/300 帧${s.complete ? '（已完成）' : ''}` : '未记录'; } };
let stageBoneTrace = null;
const stageBoneTraceStatus = () => { const node=$('stageBoneTraceStatus'); if (node) node.textContent = stageBoneTrace ? `骨骼对齐：${stageBoneTrace.frame_count}/300 帧（每帧含 input/output）${stageBoneTrace.frame_count >= 300 ? '（已完成）' : ''}` : '未记录'; };
const motionDebug = { recording: false, frames: [], maxFrames: 180, startedAt: 0, report: null };
const motionDebugOutput = value => { const node = $('#motionDebugOutput'); if (node) node.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };
function motionDebugTrackInfo(clip) {
    const tracks = clip?.tracks || [];
    const names = tracks.map(track => String(track.name || ''));
    const bones = names.map(name => name.match(/^\.bones\[([^\]]+)\]/)?.[1] || name.match(/^([^\.\[]+)\.(?:position|quaternion)$/)?.[1]).filter(Boolean);
    const morphs = names.filter(name => /(?:^|\.)morphTargetInfluences\[/.test(name));
    const targetBones = new Set((state.animationTarget?.skeleton?.bones || state.model?.skeleton?.bones || []).map(bone => bone.name));
    const matched = [...new Set(bones.filter(name => targetBones.has(name)))];
    return {
        name: clip?.name || '',
        duration: Number(clip?.duration || 0),
        tracks: tracks.length,
        boneTracks: bones.length,
        morphTracks: morphs.length,
        matchedBones: matched.length,
        unmatchedBones: [...new Set(bones.filter(name => !targetBones.has(name)))].slice(0, 80),
        sampleTracks: names.slice(0, 24),
    };
}
function buildMotionDebugReport() {
    const target = state.animationTarget || state.model;
    const actions = [...state.actions.values()].map(entry => ({ id: entry.id, label: entry.label, kind: entry.kind, clip: motionDebugTrackInfo(entry.clip) }));
    const mixer = currentMixer();
    return {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        model: { name: state.model?.name || null, format: state.modelFormat, scale: state.model?.scale?.toArray?.() || null },
        target: { name: target?.name || null, isSkinnedMesh: !!target?.isSkinnedMesh, geometry: !!target?.geometry, bones: target?.skeleton?.bones?.length || 0, morphs: Object.keys(target?.morphTargetDictionary || {}).length },
        active: { id: state.activeAction, playlist: state.activeClipIds, playing: state.playing, mixerTime: mixer?.time ?? null, liveActions: state.liveActions.map(action => ({ clip: action.getClip()?.name || '', time: action.time, weight: action.getEffectiveWeight(), enabled: action.enabled })) },
        actions,
        secondary: { enabled: secondaryMotion.enabled, bindings: secondaryMotion.bindings.length, springs: secondaryMotion.springs.length, colliders: secondaryMotion.colliders.length, missing: secondaryMotion.missing.slice(0, 100), runtime: { ...secondaryMotion.runtime } },
        frames: motionDebug.frames,
    };
}
function captureMotionDebugFrame(phase) {
    if (!motionDebug.recording || !state.model) return;
    const names = ['Hips', 'Pelvis', 'Head', 'LeftArm', 'RightArm', 'LeftFrontSkirt_A', 'RightFrontSkirt_A'];
    const bones = state.model?.skeleton?.bones || state.animationTarget?.skeleton?.bones || [];
    const byName = new Map(bones.map(bone => [bone.name, bone]));
    const values = {};
    names.forEach(name => { const bone = byName.get(name); if (bone) values[name] = { position: bone.position.toArray(), quaternion: bone.quaternion.toArray() }; });
    motionDebug.frames.push({ frame: motionDebug.frames.length, phase, mixerTime: currentMixer()?.time ?? null, action: state.activeAction, values });
    if (motionDebug.frames.length >= motionDebug.maxFrames) {
        motionDebug.recording = false;
        motionDebug.report = buildMotionDebugReport();
        motionDebugOutput(motionDebug.report);
        showToast('动作诊断记录完成，可导出 JSON');
    }
}
function startMotionDebug() {
    if (!state.model) return showToast('请先载入 GLB 或 PMX 模型', true);
    motionDebug.recording = true;
    motionDebug.frames = [];
    motionDebug.startedAt = performance.now();
    motionDebug.report = buildMotionDebugReport();
    motionDebugOutput({ ...motionDebug.report, status: 'recording', frames: [] });
    showToast('已开始记录动作诊断，请立即播放动作并等待 180 帧');
}
function exportMotionDebug() {
    const report = motionDebug.report || buildMotionDebugReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `motion-debug-${state.modelFormat || 'unknown'}-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportGlbMotionPack() {
    if (state.modelFormat !== 'glb' || !state.model) {
        showToast('请先载入 GLB 模型', true);
        return;
    }
    const actions = [...state.actions.values()].map(entry => ({
        id: entry.id,
        label: entry.label,
        kind: entry.kind,
        clip: entry.clip.toJSON(),
    }));
    if (!actions.length) {
        showToast('当前还没有已转换的 GLB 动作', true);
        return;
    }
    const payload = {
        format: 'mmd-stage-glb-motion-pack',
        version: 1,
        model: state.modelFile?.name || state.model.name || 'GLB',
        bones: (state.model.skeleton?.bones || []).map(bone => bone.name),
        actions,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(payload.model).replace(/\.[^.]+$/, '')}-glb-motions.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 ${actions.length} 个 GLB 动作`);
}

async function importGlbMotionPack(file) {
    if (state.modelFormat !== 'glb' || !state.model) {
        showToast('请先载入对应的 GLB 模型', true);
        return;
    }
    try {
        const payload = JSON.parse(await file.text());
        if (payload?.format !== 'mmd-stage-glb-motion-pack' || !Array.isArray(payload.actions)) {
            throw new Error('不是有效的 GLB 动作包');
        }
        const boneNames = new Set((state.model.skeleton?.bones || []).map(bone => bone.name));
        const imported = [];
        for (const [index, entry] of payload.actions.entries()) {
            if (!entry?.clip) continue;
            const clip = THREE.AnimationClip.parse(entry.clip);
            const missing = clip.tracks
                .map(track => String(track.name).match(/^([^\.]+)\.(?:position|quaternion)$/)?.[1])
                .filter(name => name && !boneNames.has(name));
            if (missing.length) continue;
            const id = String(entry.id || entry.label || `glb-${index}`);
            state.actions.set(id, { id, label: entry.label || id, clip, kind: entry.kind || 'body' });
            imported.push(id);
        }
        rebuildPlaylist();
        renderMotionLibrary();
        if (!imported.length) throw new Error('动作包中的骨骼与当前 GLB 不匹配');
        showToast(`已导入 ${imported.length} 个 GLB 动作`);
    } catch (error) {
        console.error('[MMD Stage] GLB motion pack import failed', error);
        showToast(`GLB 动作包导入失败：${error.message || '文件格式错误'}`, true);
    }
}
function startStageBoneTrace() {
    const isHski = state.library.activeIdol === 'hski';
    stageBoneTrace = createStageBoneTrace({
        idol: state.library.activeIdol || null,
        event: isHski ? '肯定' : null,
        motion: isHski ? '型A-001进入' : null,
        capture_reference: isHski ? 'capture-2026-9-27-7-45-7-35392-10545781' : null,
        capture_frame_count: isHski ? 108 : null,
        model: state.model?.name || null,
        source: 'stage-bone-alignment',
        phase_semantics: {
            input: 'after_animation_before_secondary_motion',
            output: 'after_secondary_motion_and_matrix_refresh',
        },
    });
    stageBoneTraceStatus();
}
function captureStageBoneTraceFrame(phase = 'output') {
    if (!stageBoneTrace || stageBoneTrace.frame_count >= 300 || !state.model) return;
    const mixer = currentMixer();
    const action = state.liveActions.find(item => item?.isRunning?.()) || state.liveActions[0];
    const frameId = stageBoneTrace.frame_count + 1;
    const frame = buildStageBoneTraceFrame(state.skeletonBones || state.model.skeleton?.bones || [], {
        frameId,
        phase,
        timestampMs: typeof performance !== 'undefined' && Number.isFinite(performance.now()) ? performance.now() : Date.now(),
        action: state.activeAction || null,
        actionTime: action && Number.isFinite(Number(action.time)) ? Number(action.time) : mixer?.time,
    });
    stageBoneTrace.frames.push(frame);
    if (phase === 'output') stageBoneTrace.frame_count = frameId;
    stageBoneTraceStatus();
}
function exportStageBoneTrace() {
    if (!stageBoneTrace || !stageBoneTrace.frames.length) { showToast('还没有骨骼对齐记录', true); return; }
    const blob = new Blob([JSON.stringify(stageBoneTrace, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stage-bone-trace-${state.library.activeIdol || 'unknown'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let secondaryMotionBindGeneration = 0;
let modelLoadGeneration = 0;
let gakumasTextureLoadGeneration = 0;
function modelVariantKey(name) {
    return String(name || '')
        .split(/[\\/]/).pop()
        .replace(/\.[^.]+$/, '')
        .replace(/-glb-hair-layer$/i, '')
        .toLowerCase();
}

function modelVariantId(modelKey) {
    return String(modelKey || '').split('-')[0] || '';
}

const secondaryMotionReady = (profileKey, fallbackId = '') => {
    const key = profileKey || fallbackId || 'fallback';
    if (secondaryMotionTables.has(key)) return secondaryMotionTables.get(key);
        const request = fetch(`./secondary-motion-manifest.json?v=20261001-glb-variant-profiles-v6-ttmr-native-chain-remap`)
        .then(response => response.ok ? response.json() : null)
        .catch(() => null)
        .then(manifest => {
            const entry = manifest?.models?.find(item =>
                item?.modelKey === profileKey || item?.aliases?.includes(profileKey));
            const profileUrl = entry?.profile
                ? `./${String(entry.profile).replace(/^\.\//, '')}`
                : `./secondary-motion-profiles/${encodeURIComponent(fallbackId || profileKey || 'fktn')}.json`;
            return fetch(`${profileUrl}?v=20261002-secondary-motion-v25-kcna-native-skirt`)
                .then(response => response.ok ? response.json() : fetch(`./gakumas-secondary-motion.json?v=20261002-secondary-motion-v25-kcna-native-skirt`).then(fallback => {
                    if (!fallback.ok) throw new Error(fallback.statusText);
                    return fallback.json();
                }));
        })
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
const postPass = new GakumasPostPass(renderer);
const POST_MODULES = [
    ['postBloom', 'bloom'],
    ['postDiffusion', 'diffusion'],
    ['postParaffin', 'paraffin'],
    ['postChroma', 'chromatic'],
    ['postVignette', 'vignette'],
    ['postTaa', 'taa'],
];

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
characterShadowLight.shadow.mapSize.set(4096, 4096);
characterShadowLight.shadow.camera.left = -10;
characterShadowLight.shadow.camera.right = 10;
characterShadowLight.shadow.camera.top = 10;
characterShadowLight.shadow.camera.bottom = -10;
characterShadowLight.shadow.camera.near = 0.05;
characterShadowLight.shadow.camera.far = 30;
characterShadowLight.shadow.bias = 0;
characterShadowLight.shadow.normalBias = 0;
characterShadowLight.shadow.radius = 0;
characterShadowLight.userData.gakumasCharacterShadow = true;
scene.add(characterShadowLight.target, characterShadowLight);
const characterShadowFit = { center: new THREE.Vector3(0, 8, 0), radius: 10 };

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
const sceneStage = new GakumasSceneStage({ scene, scale: GLB_STAGE_SCALE });
const DEFAULT_CAMERA_FOV = camera.fov;
let gridWanted = true;

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
    $('#exportGlbMotionPackBtn')?.addEventListener('click', exportGlbMotionPack);
    $('#importGlbMotionPackBtn')?.addEventListener('click', () => $('#glbMotionPackInput')?.click());
    $('#glbMotionPackInput')?.addEventListener('change', event => {
        [...event.target.files].forEach(importGlbMotionPack);
        event.target.value = '';
    });
    $('#motionDebugStartBtn')?.addEventListener('click', startMotionDebug);
    $('#motionDebugExportBtn')?.addEventListener('click', exportMotionDebug);
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
    $('#secondaryMotionToggle')?.addEventListener('change', event => {
        secondaryMotion.enabled = event.target.checked;
        secondaryMotion.update();
        renderSecondaryMotionStatus();
    });
    $('#clothingTraceStartBtn')?.addEventListener('click', () => { secondaryMotion.startClothingTrace({ idolId: state.library.activeIdol, model: state.model?.name || null }); startStageBoneTrace(); clothingTraceStatus(); showToast('已开始记录衣物与骨骼对齐数据'); });
    $('#clothingTraceExportBtn')?.addEventListener('click', () => { const trace=secondaryMotion.getClothingTrace(); if (!trace) { showToast('还没有衣物诊断记录', true); return; } const blob=new Blob([JSON.stringify(trace,null,2)], {type:'application/json'}); const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=`secondary-motion-${state.library.activeIdol || 'unknown'}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); });
    $('#stageBoneTraceExportBtn')?.addEventListener('click', exportStageBoneTrace);
    $('#colliderDebugToggle')?.addEventListener('change', event => {
        colliderDebug.enabled = event.target.checked;
        colliderDebug.group.visible = colliderDebug.enabled && !!state.model;
        renderSecondaryMotionStatus();
    });
    $('#colliderDebugSelect')?.addEventListener('change', event => {
        colliderDebug.selected = event.target.value || 'all';
        updateColliderDebug();
    });
    bindLightControl('gakumasHairCoverMinimum', null, null, value => {
        state.gakumasPasses.hairCoverMinimum = value;
        updateGakumasUniforms();
    });
    bindLightControl('gakumasBloom', null, null, value => lookPass.setBloom({ intensity: value }));
    bindLightControl('gakumasBloomKnee', null, null, value => lookPass.setBloom({ knee: value }));
    bindLightControl('gakumasBloomRadius', null, null, value => lookPass.setBloom({ radius: value }));
    $('#resetCameraBtn').addEventListener('click', resetCamera);
    $('#toggleGridBtn').addEventListener('click', event => {
        gridWanted = !gridWanted;
        grid.visible = gridWanted && !sceneStage.loaded;
        event.currentTarget.classList.toggle('is-active', gridWanted);
        event.currentTarget.setAttribute('aria-pressed', String(gridWanted));
    });
    $('#sceneSelect')?.addEventListener('change', event => selectStageScene(event.currentTarget.value));
    $('#sceneLayout')?.addEventListener('change', event => {
        if (!sceneStage.applyLayout(event.currentTarget.value)) return;
        applySceneCamera();
        syncScenePost();
        renderSceneStatus();
    });
    for (const [id, name] of POST_MODULES) {
        $(`#${id}`)?.addEventListener('change', event => postPass.setModule(name, event.target.checked));
    }
    $('#sceneCameraBtn')?.addEventListener('click', applySceneCamera);
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
    const characterShadow = placeCharacterShadowLight(characterShadowLight, camera, characterShadowFit);
    state.gakumasUniforms.forEach(uniforms => {
        uniforms.gkLightDirection.value.copy(direction);
        uniforms.gkLightColor.value.copy(keyLight.color);
        uniforms.gkLightStrength.value = keyLight.intensity;
        uniforms.gkRimColor.value.copy(rimLight.color);
        uniforms.gkRimStrength.value = rimLight.intensity;
        uniforms.gkShadowStrength.value = state.shadowStrength;
        uniforms.gkHeadRight.value.copy(state.gakumasHeadRight);
        uniforms.gkDebugView.value = state.gakumasDebugView;
        uniforms.gkCharacterShadowEnabled.value = state.gakumasPasses.characterShadow && characterShadowLight.shadow.map ? 1 : 0;
        uniforms.gkCharacterShadowMap.value = characterShadowLight.shadow.map?.texture || null;
        uniforms.gkCharacterShadowMatrix.value.copy(characterShadowLight.shadow.matrix);
        uniforms.gkCharacterShadowContact.value = characterShadow?.contact || 0.001;
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
    const glbFiles = files.filter(file => file.name.toLowerCase().endsWith('.glb'));
    if (glbFiles.length) {
        if (glbFiles.length > 1) showToast(`找到 ${glbFiles.length} 个 GLB，已载入 ${glbFiles[0].name}`);
        const glbFile = glbFiles[0];
        await loadModelFromSource({
            name: glbFile.name,
            url: createObjectUrl(glbFile),
            textures: [...files, ...state.textureFiles],
            fileMapFiles: [...files, ...state.textureFiles],
            modelKey: modelVariantKey(glbFile.name),
            idolId: modelVariantId(modelVariantKey(glbFile.name)),
            format: 'glb',
        });
        return;
    }
    const pmxFiles = files.filter(file => file.name.toLowerCase().endsWith('.pmx'));
    if (!pmxFiles.length) {
        showToast('所选文件夹中没有找到 GLB 或 PMX 模型', true);
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
        format: 'pmx',
    });
}

async function loadModelFromSource({ name, url, textures, fileMapFiles, idolId, modelKey = '', format = 'pmx' }) {
    const generation = ++modelLoadGeneration;
    setStatus(`正在载入 ${name}`);
    $('#runtimeBadge').textContent = '载入中';
    // Keep the actual source URL. A later texture-folder selection reloads the
    // current model; storing only its display name would make the code pass a
    // plain string to URL.createObjectURL().
    state.modelFile = { name, url, format, idolId, modelKey };
    state.modelFormat = format;
    state.gltf = null;
    const fileMap = fileMapFiles?.length ? buildFileMap(fileMapFiles) : null;
    const manager = new THREE.LoadingManager();
    // GLB baseColor images are embedded in the file. Keep the supplemental
    // PMX texture folder out of GLTFLoader's URL rewriting, otherwise a
    // matching body texture can replace the GLB hair/eye base map.
    // Supplemental shade/ramp/highlight maps are loaded separately below.
    if (format !== 'glb') {
        manager.setURLModifier(resource => (fileMap && resolveLocalResource(resource, fileMap)) || resource);
    }
    clearColliderDebug();
    try {
        let model;
        let animationTarget;
        if (format === 'glb') {
            const loader = new GLTFLoader(manager);
            const gltf = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
            if (generation !== modelLoadGeneration) return false;
            model = gltf.scene;
            model.traverse(child => {
                if (!child.isMesh) return;
                const geometry = child.geometry;
                const packed = geometry.getAttribute('_gakumas_vertex_color') || geometry.getAttribute('color');
                if (packed?.itemSize === 4) {
                    geometry.setAttribute('gakumasVertexColor', packed);
                    geometry.userData.gakumasPackedVertexColor = true;
                }
                // Legacy exports used COLOR_0 for packed game shader data.
                // Never multiply that data into the actor's base texture.
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => {
                    if (material?.map && !material.userData.gakumasEmbeddedBaseMap) {
                        material.userData.gakumasEmbeddedBaseMap = material.map;
                    }
                    material.vertexColors = false;
                    material.name = material.name.replace(/\s*\[(?:HairPortFallback|GLB)\]/g, '').trim();
                    material.needsUpdate = true;
                });
            });
            state.gltf = gltf;
            const skinned = [];
            model.traverse(child => { if (child.isSkinnedMesh && child.skeleton) skinned.push(child); });
            if (!skinned.length) throw new Error('GLB 中没有找到 SkinnedMesh 骨架');
            // MMDLoader builds VMD tracks against model.skeleton. Expose the
            // same small compatibility surface on the GLB root so the
            // existing motion library can drive either model source.
            // The face mesh owns the Morph dictionary, while the body mesh
            // owns the complete shared skeleton. They must not be conflated:
            // the face skin in this GLB has only seven face bones, which made
            // every body VMD track disappear and also starved secondary motion.
            const skin = skinned.reduce((best, item) =>
                (item.skeleton?.bones?.length || 0) > (best?.skeleton?.bones?.length || 0) ? item : best,
            skinned[0]);
            const morphSkin = skinned.find(item => item.morphTargetDictionary && Object.keys(item.morphTargetDictionary).length) || skin;
            animationTarget = skin;
            model.skeleton = skin.skeleton;
            model.morphTargetDictionary = morphSkin.morphTargetDictionary || {};
            model.morphTargetInfluences = morphSkin.morphTargetInfluences || [];
            animationTarget.userData.glbMorphTarget = morphSkin;
            // MMDLoader assumes the target always owns a morph dictionary.
            // GLB body meshes often have none even though the face mesh does.
            // An empty dictionary keeps skeletal VMD tracks loadable; morph
            // tracks are handled by the face mesh path when it exists.
            animationTarget.morphTargetDictionary = morphSkin.morphTargetDictionary || {};
            animationTarget.morphTargetInfluences = morphSkin.morphTargetInfluences || [];
            model.scale.setScalar(GLB_STAGE_SCALE);
        } else {
            const loader = new MMDLoader(manager);
            loader._extractExtension = () => name.toLowerCase().endsWith('.pmd') ? 'pmd' : 'pmx';
            model = await new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
            if (generation !== modelLoadGeneration) return false;
            animationTarget = model;
        }
        if (state.model) {
            hairCoverStage.dispose();
            const oldTarget = state.animationTarget || state.model;
            if (state.helper.objects.has(oldTarget)) state.helper.remove(oldTarget);
            state.animationMixer = null;
            scene.remove(state.model);
            disposeObject(state.model);
        }
        state.model = model;
        state.animationTarget = animationTarget;
        // UnityGLTF materials are PBR carriers for the embedded base maps.
        // GLB actors must enter the same Gakumas shader/look pipeline as the
        // library path; otherwise a manually selected GLB stays in the MMD
        // preset and bypasses the actor shader entirely.
        if (format === 'glb') applyRenderPreset('gakumas');
        state.library.activeIdol = idolId || identifyLibraryIdol(state.library.config, name)?.id || (/hski/i.test(name) ? 'hski' : '');
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
        // Physics records are authored in Unity-local units, while GLB is
        // enlarged for the Stage view. Feed that parent scale to the solver
        // so tail lengths, gravity and collider radii share world units.
        secondaryMotion.worldScale = format === 'glb'
            ? Math.max(Math.abs(Number(model.scale.x)) || 1, Math.abs(Number(model.scale.y)) || 1, Math.abs(Number(model.scale.z)) || 1)
            : 1;
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
        if (generation !== modelLoadGeneration) return false;
        applyMaterialStyle();
        fitCharacterShadowToModel(model);
        if (state.modelFormat !== 'glb') state.helper.add(state.animationTarget, { physics: false });
        frameModel(model);
        renderMorphControls();
        bindLipSyncMorphs();
        renderMotionLibrary();
        renderIdolList();
        $('#emptyState').classList.add('is-hidden');
        $('#modelFileName').textContent = name;
        $('#modelSummary').textContent = `${name} · ${getMorphNames().length} 个 Morph · ${format.toUpperCase()}`;
        $('#runtimeBadge').textContent = '模型就绪';
        $('#runtimeBadge').classList.add('is-ready');
        setStatus('模型已载入，可从动作库选择动作', 'ready');
        showToast(`${format === 'glb' ? 'GLB' : 'PMX'} 模型载入完成`);
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
            key: GAKUMAS_LOOK.key, hemi: GAKUMAS_LOOK.hemi, rim: 1, shadow: GAKUMAS_LOOK.shadow,
            keyAzimuth: GAKUMAS_LOOK.keyAzimuth, keyElevation: GAKUMAS_LOOK.keyElevation,
            shadowAzimuth: GAKUMAS_LOOK.shadowAzimuth, shadowElevation: GAKUMAS_LOOK.shadowElevation,
            keyColor: GAKUMAS_LOOK.keyColor, rimColor: '#ffffff',
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
    state.gakumasUniforms.clear();
    state.model.traverse(child => {
        if (!child.isMesh) return;
        let hasCharacterShadowCaster = false;
        child.userData.gakumasShadowMaterialMask = state.materialMode === 'gakumas' ? [] : null;
        applyOutlineToMaterial(child.material, child);
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material, materialIndex) => {
            // PMX materials arrive as MMDToonMaterial. UnityGLTF uses
            // MeshStandardMaterial, but the actor shader is built on the
            // standard Three.js lighting chunks and can serve both sources.
            if (!material || (!material.isMMDToonMaterial && state.modelFormat !== 'glb')) return;
            if (state.modelFormat === 'glb' && !material.map && material.userData.gakumasEmbeddedBaseMap) {
                material.map = material.userData.gakumasEmbeddedBaseMap;
                material.needsUpdate = true;
            }
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
            material.defines = {
                ...baseDefines,
                GK_HAIR: role === 'hair' || actorPass === 'hairHighlight',
                GK_HAIR_HIGHLIGHT_PASS: actorPass === 'hairHighlight',
                GK_FACE: role === 'face',
                GK_EYE: role === 'eye' || role === 'eyeHighlight',
                GK_EYE_HIGHLIGHT: material.name.toLowerCase() === 'm_ehl' || actorPass === 'eyeHighlight',
            };
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
            // PMX m_hir+ is a duplicated overlay used for the sphere/highlight
            // layer. The GLB carries the same geometry and hir_sph map, but
            // MeshStandardMaterial defaults to an opaque base-color pass,
            // which hides the regular m_hir layer. Recreate the PMX overlay
            // semantics here.
            if (state.modelFormat === 'glb' && actorPass === 'hairHighlight') {
                material.transparent = true;
                material.blending = THREE.AdditiveBlending;
                material.depthWrite = false;
                material.renderOrder = 18;
                material.opacity = 0.55;
            }
            material.depthTest = true;
            material.alphaTest = actorPass === 'eye' || actorPass === 'eyeHighlight' ? 0 : 0.33;
            material.side = THREE.FrontSide;
            material.colorWrite = true;
            if (isEyeLayer) {
                material.transparent = true;
                material.depthTest = false;
                material.depthWrite = false;
                material.renderOrder = material.name.toLowerCase() === 'm_ehl' ? 32 : 30;
                material.alphaTest = 0.01;
            }
            if (material.name.toLowerCase() === 'm_ehl' || actorPass === 'eyeHighlight') {
                // m_ehl is a separate eye highlight card. It must be blended
                // over m_eye at the same depth instead of failing the depth
                // test against the iris surface.
                material.transparent = true;
                material.blending = THREE.NormalBlending;
                material.depthTest = false;
                material.depthWrite = false;
                material.renderOrder = 32;
                material.opacity = 1;
                material.alphaTest = 0.01;
            }
            applyStencilState(material, actorStencilState(material.name, actorPass));
            material.onBeforeCompile = state.materialMode === 'gakumas' ? shader => injectActorShader(shader, uniforms) : () => {};
            material.customProgramCacheKey = () => `gakumas-v2:${state.materialMode}:${role}:rim-v1`;
            material.needsUpdate = true;
            material.visible = true;
            if (state.materialMode === 'gakumas') {
                hairCoverStage.add(child, material, materialIndex, uniforms, hairTextureName);
                if (actorPass === 'hairHighlight') hairCoverStage.addHighlight(child, material, materialIndex);
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
    const generation = ++gakumasTextureLoadGeneration;
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
    if (generation !== gakumasTextureLoadGeneration) {
        entries.forEach(entry => entry.texture?.dispose());
        return false;
    }
    state.gakumasTextures.forEach(entry => entry.texture?.dispose());
    state.gakumasTextures = entries;
    return true;
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
        gkRimDirection: { value: new THREE.Vector3(...GAKUMAS_LOOK.rimView) },
        gkRimColor: { value: new THREE.Color(0xffffff) },
        gkRimStrength: { value: 1 },
        gkRimPower: { value: GAKUMAS_LOOK.rimPower },
        gkRimAlbedo: { value: GAKUMAS_LOOK.rimAlbedo },
        gkDebugView: { value: 0 },
        gkCharacterShadowMap: { value: null },
        gkCharacterShadowMatrix: { value: new THREE.Matrix4() },
        gkCharacterShadowEnabled: { value: 0 },
        gkCharacterShadowReceive: { value: 1 },
        gkCharacterShadowContact: { value: 0.001 },
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
    $('#gakumasHairCoverStatus').textContent = `HairCover：${hairCoverStage.entries.reduce((count, entry) => count + entry.groups.length, 0)} 个 m_hir 面组就绪；m_hir+ 高光在 HairCover 后补绘。`;
    const shadowStatus = $('#gakumasCharacterShadowStatus');
    if (shadowStatus) shadowStatus.textContent = '角色阴影：4K 深度图，光源跟摄像机。脸、眼睛和高光层不写入；头发、身体和衣服写入，并在脸、眼睛、头发、身体和衣服上采样。';
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

async function addTextureFiles(files) {
    state.textureFiles = files;
    // GLB already contains its baseColor maps and materials. Re-loading the
    // file just to add supplemental Gakumas maps can recreate MeshStandard
    // materials at the wrong point in the pipeline and lose the embedded eye
    // map. Update only the auxiliary texture uniforms for an existing GLB.
    if (state.model && state.modelFormat === 'glb') {
        await loadGakumasTextures(files);
        if (state.materialMode !== 'gakumas') applyRenderPreset('gakumas');
        else applyMaterialStyle();
        updateGakumasUniforms();
        renderGakumasInspector();
        showToast('已载入 ' + files.length + ' 个补充贴图');
        return;
    }
    if (state.modelFile) {
        loadModelFromSource({
            ...state.modelFile,
            textures: files,
            fileMapFiles: files,
        });
    } else {
        showToast(`已暂存 ${files.length} 个贴图文件，请再选择模型。`);
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

// VMD stores MMD bone names, while the GLB exporter keeps the Unity bone
// names.  HSKI's exported skeleton already uses the same English names for
// most tracks, but a VMD from an MMD tool can still contain the usual
// Japanese aliases.  Remap those aliases before MMDLoader builds tracks;
// otherwise the loader silently drops the bone motion.
const VMD_GLB_BONE_ALIASES = new Map([
    ['センター', 'Center'], ['全ての親', 'Root'], ['上半身', 'UpperBody'], ['上半身2', 'UpperBody2'],
    ['下半身', 'LowerBody'], ['首', 'Neck'], ['頭', 'Head'], ['左目', 'LeftEye'], ['右目', 'RightEye'],
    ['左肩', 'LeftShoulder'], ['右肩', 'RightShoulder'], ['左腕', 'LeftArm'], ['右腕', 'RightArm'],
    ['左ひじ', 'LeftForeArm'], ['右ひじ', 'RightForeArm'], ['左手首', 'LeftHand'], ['右手首', 'RightHand'],
    ['左足', 'LeftUpLeg'], ['右足', 'RightUpLeg'], ['左ひざ', 'LeftLeg'], ['右ひざ', 'RightLeg'],
    ['左足首', 'LeftFoot'], ['右足首', 'RightFoot'], ['左つま先', 'LeftToeBase'], ['右つま先', 'RightToeBase'],
    // The PMX writer shortens these three names to fit VMD's 15-byte bone
    // field. The GLB keeps Unity's full names.
    ['RHandMiddle1', 'RightHandMiddle1'], ['RHandMiddle2', 'RightHandMiddle2'], ['RHandMiddle3', 'RightHandMiddle3'],
]);

function normalizedBoneKey(name) {
    return String(name || '').trim().replace(/[\s_\-.]/g, '').toLowerCase();
}

function resolveVmdBoneName(rawName, target) {
    const bones = target?.skeleton?.bones || [];
    const exact = new Map(bones.map(bone => [bone.name, bone.name]));
    if (exact.has(rawName)) return rawName;
    const alias = VMD_GLB_BONE_ALIASES.get(String(rawName || '').trim());
    if (alias && exact.has(alias)) return alias;
    const byKey = new Map(bones.map(bone => [normalizedBoneKey(bone.name), bone.name]));
    const rawKey = normalizedBoneKey(rawName);
    const variants = [
        rawKey,
        rawKey.replace(/^(?:j)?(?:bip)?(?:c|l|r)?/, ''),
        rawKey.replace(/^(?:j_)?(?:bip_)?(?:c_|l_|r_)?/i, ''),
    ].filter(Boolean);
    for (const variant of variants) {
        if (byKey.has(variant)) return byKey.get(variant);
    }
    // Some exporters retain a Unity/Blender prefix around the original PMX
    // name. Accept a unique suffix match, but avoid short ambiguous names.
    const suffixMatches = bones.filter(bone => {
        const key = normalizedBoneKey(bone.name);
        return Math.min(key.length, rawKey.length) >= 5 && (key.endsWith(rawKey) || rawKey.endsWith(key));
    });
    return suffixMatches.length === 1 ? suffixMatches[0].name : rawName;
}

function loadVmdAnimationForTarget(loader, url, target, onLoad, onError) {
    if (state.modelFormat !== 'glb') {
        loader.loadAnimation(url, target, onLoad, undefined, onError);
        return;
    }
    loader.loadVMD(url, vmd => {
        const morphTarget = target?.userData?.glbMorphTarget || target;
        const motions = vmd.motions || [];
        motions.forEach(motion => {
            motion.boneName = resolveVmdBoneName(motion.boneName, target);
        });
        // Morph names are usually preserved by UnityGLTF. Keep exact matches
        // and let AnimationBuilder discard only morphs absent from the GLB.
        const morphs = vmd.morphs || [];
        const dictionary = morphTarget?.morphTargetDictionary || {};
        const morphKeys = Object.keys(dictionary);
        const morphKey = value => {
            const raw = String(value || '').trim();
            const aliases = [raw, raw.replace(/^b_mouth\./i, '')];
            for (const alias of aliases) if (dictionary[alias] !== undefined) return alias;
            const normalized = aliases.map(alias => normalizedBoneKey(alias));
            return morphKeys.find(name => normalized.includes(normalizedBoneKey(name))) || '';
        };
        let matchedMorphs = 0;
        morphs.forEach(morph => {
            const key = morphKey(morph.morphName);
            if (key) {
                morph.morphName = key;
                matchedMorphs++;
            }
        });
        const clip = loader.animationBuilder.build(vmd, target);
        if (vmd.metadata?.morphCount && !matchedMorphs) {
            console.warn('[MMD Stage] no VMD morphs matched GLB dictionary', {
                sourceMorphs: vmd.metadata.morphCount,
                glbMorphs: morphKeys.length,
                sample: morphs.slice(0, 8).map(morph => morph.morphName),
            });
        }
        // Unity -> PMX/VMD uses (-x, y, -z, w). MMDParser then applies
        // (-x, -y, z, w), which is exactly the UnityGLTF GLB basis. There is
        // no additional left/right or per-side reflection at this point.
        if (target?.skeleton?.bones?.length) {
            const bones = new Map(target.skeleton.bones.map(bone => [bone.name, bone]));
            const quaternionTracks = new Map();
            clip.tracks.forEach(track => {
                const match = track.name.match(/^\.bones\[([^\]]+)\]\.quaternion$/)
                    || track.name.match(/^([^\.]+)\.quaternion$/);
                if (match && track.values.length % 4 === 0 && bones.has(match[1])) quaternionTracks.set(match[1], track);
            });
            const rest = new Map((state.restPose || []).map(entry => [entry.bone, entry.quaternion.clone()]));
            const depth = bone => {
                let value = 0;
                for (let parent = bone.parent; parent && parent !== target; parent = parent.parent) value++;
                return value;
            };
            const orderedBones = [...bones.values()].sort((left, right) => depth(left) - depth(right));
            const deltaWorld = new Map();
            const restWorld = new Map();
            const animationWorld = new Map();
            const identity = new THREE.Quaternion();
            const trackLength = [...quaternionTracks.values()][0]?.values.length || 0;
            const frameCount = Math.floor(trackLength / 4);
            for (let frame = 0; frame < frameCount; frame++) {
                deltaWorld.clear();
                restWorld.clear();
                animationWorld.clear();
                for (const bone of orderedBones) {
                    const parent = bones.get(bone.parent?.name);
                    const parentDelta = parent ? deltaWorld.get(parent) || identity : identity;
                    const parentRest = parent ? restWorld.get(parent) || identity : identity;
                    const track = quaternionTracks.get(bone.name);
                    const offset = track
                        ? new THREE.Quaternion(track.values[frame * 4], track.values[frame * 4 + 1], track.values[frame * 4 + 2], track.values[frame * 4 + 3]).normalize()
                        : identity;
                    const bind = rest.get(bone) || bone.quaternion.clone();
                    const currentDelta = parentDelta.clone().multiply(offset).normalize();
                    const currentRest = parentRest.clone().multiply(bind).normalize();
                    const currentAnimation = currentDelta.clone().multiply(currentRest).normalize();
                    deltaWorld.set(bone, currentDelta);
                    restWorld.set(bone, currentRest);
                    animationWorld.set(bone, currentAnimation);
                    if (!track) continue;
                    const local = parent
                        ? (animationWorld.get(parent) || identity).clone().invert().multiply(currentAnimation).normalize()
                        : currentAnimation;
                    track.values[frame * 4] = local.x;
                    track.values[frame * 4 + 1] = local.y;
                    track.values[frame * 4 + 2] = local.z;
                    track.values[frame * 4 + 3] = local.w;
                }
            }
            clip.tracks.forEach(track => {
                const match = track.name.match(/^\.bones\[([^\]]+)\]\.position$/);
                if (!match || track.values.length % 3 !== 0) return;
                const bone = bones.get(match[1]);
                if (!bone) return;
                const bind = bone.position;
                for (let i = 0; i < track.values.length; i += 3) {
                    track.values[i] = bind.x + (track.values[i] - bind.x) / 12.5;
                    track.values[i + 1] = bind.y + (track.values[i + 1] - bind.y) / 12.5;
                    track.values[i + 2] = bind.z + (track.values[i + 2] - bind.z) / 12.5;
                }
            });
        }
        const morphBinding = bindGlbMorphTracks(clip, dictionary, state.model);
        console.info('[MMD Stage] GLB VMD morph binding', {
            url, sourceMorphFrames: morphs.length, matchedMorphFrames: matchedMorphs, ...morphBinding,
        });
        if (morphs.length && morphBinding.boundTracks === 0) showToast('面部 VMD 未绑定到 GLB 网格，请查看表情绑定诊断', true);
        // MMDAnimationHelper uses the `.bones[Name]` convention. For GLB,
        // bind directly to the named Bone node so AnimationMixer does not
        // depend on the root Group exposing a MMD-style bones array.
        clip.tracks.forEach(track => {
            const match = track.name.match(/^\.bones\[([^\]]+)\](\..+)$/);
            if (match) track.name = `${match[1]}${match[2]}`;
        });
        onLoad(clip);
    }, undefined, onError);
}

async function importMotionEntries(entries, options = {}) {
    const loader = new MMDLoader();
    let loaded = 0;
    for (const entry of entries) {
        if (state.actions.has(entry.id)) continue;
        try {
            const clip = await new Promise((resolve, reject) => loadVmdAnimationForTarget(
                loader,
                entry.url,
                state.animationTarget || state.model,
                resolve,
                reject,
            ));
            rebaseHairAnimationTracks(clip, state.hairRestRebase);
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
            fetch('./library.json?v=20261002-idol-glb', { cache: 'no-store' }).then(response => response.json()),
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
        renderSceneOptions();
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
        .filter(name => !idol.textureDir || name.replaceAll('\\', '/').startsWith(`${idol.textureDir}/`))
        .map(name => name.split('/').pop());
    const model = selectIdolModel(idol, packFiles);
    const assets = idolAssetUrls({ ...idol, model: model.name }, state.library.config, textureNames.filter(name => /\.(png|jpe?g|webp|spa|sph)$/i.test(name)), libraryOverrides());
    setStatus(`正在载入 ${idol.name}`);
    const loaded = await loadModelFromSource({
        name: model.name,
        url: assets.modelUrl,
        textures: assets.textures,
        idolId: idol.id,
        modelKey: model.format === 'glb' ? modelVariantKey(model.name) : '',
        format: model.format,
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
    const glbProfile = state.modelFormat === 'glb';
    if (!supportsSecondaryMotion(idol) && !glbProfile) {
        status.textContent = '当前模型尚未配置专用二次运动；未套用琴音的头发、裙摆和碰撞参数。';
        renderColliderAuthoring();
        return;
    }
    const follow = secondaryMotion.bindings.length;
    const springs = secondaryMotion.springs.length;
    const colliders = secondaryMotion.colliders.length;
    const missing = secondaryMotion.missing;
    const runtime = secondaryMotion.runtime || {};
    const skirtQuartz = glbProfile
        ? `，裙摆公式 ${Number(runtime.skirtQuartzDrivers) || 0} 根，最大根部转角 ${(Number(runtime.skirtQuartzMaxAngle) || 0).toFixed(1)}°`
        : '';
    const ticking = Number(runtime.fixedSteps || 0) > 0
        ? `，已运行 ${runtime.fixedSteps} 个物理步${skirtQuartz}，最大弹簧偏转 ${(Number(runtime.maxAngularOffset) || 0).toFixed(1)}°，碰撞命中 ${Number(runtime.staticCollisionHits) || 0} 次（大腿 ${Number(runtime.thighCollisionHits) || 0}，链段 ${Number(runtime.thighChainCollisionHits) || 0}）`
        : '，尚未运行物理步';
    status.textContent = missing.length
        ? `二次动作已绑定跟随 ${follow}、弹簧 ${springs}、碰撞 ${colliders}，未找到 ${missing.length} 项${ticking}`
        : `二次动作已绑定 ${follow} 个跟随、${springs} 个弹簧、${colliders} 个碰撞体${ticking}。游戏半径为米，当前骨架缩放 ${secondaryMotion.scale.toFixed(2)}。`;
    renderColliderAuthoring();
}

function colliderDebugMaterial(color, opacity) {
    return new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity, depthWrite: false });
}

function makeDebugTaperedCapsuleGeometry(length, startRadius, endRadius) {
    const radialSegments = 16;
    const capSegments = 4;
    const profile = [];
    const halfLength = length * 0.5;
    const safeStartRadius = Math.max(Number(startRadius) || 0, 0.001);
    const safeEndRadius = Math.max(Number(endRadius) || 0, 0.001);
    for (let index = 0; index < capSegments; index++) {
        const angle = -Math.PI * 0.5 + (index / capSegments) * Math.PI * 0.5;
        profile.push({ y: -halfLength + Math.sin(angle) * safeStartRadius, radius: Math.cos(angle) * safeStartRadius });
    }
    for (let index = 0; index <= capSegments; index++) {
        const t = index / capSegments;
        profile.push({
            y: -halfLength + length * t,
            radius: safeStartRadius + (safeEndRadius - safeStartRadius) * t,
        });
    }
    for (let index = 1; index <= capSegments; index++) {
        const angle = (index / capSegments) * Math.PI * 0.5;
        profile.push({ y: halfLength + Math.sin(angle) * safeEndRadius, radius: Math.cos(angle) * safeEndRadius });
    }
    const positions = [];
    const indices = [];
    profile.forEach(({ y, radius }) => {
        for (let segment = 0; segment < radialSegments; segment++) {
            const angle = (segment / radialSegments) * Math.PI * 2;
            positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        }
    });
    for (let ring = 0; ring < profile.length - 1; ring++) {
        for (let segment = 0; segment < radialSegments; segment++) {
            const next = (segment + 1) % radialSegments;
            const a = ring * radialSegments + segment;
            const b = ring * radialSegments + next;
            const c = (ring + 1) * radialSegments + next;
            const d = (ring + 1) * radialSegments + segment;
            indices.push(a, b, d, b, c, d);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
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

function fitDebugCapsule(mesh, start, end, startRadius, endRadius) {
    const sx = start[0];
    const sy = start[1];
    const sz = start[2];
    const length = Math.hypot(end[0] - sx, end[1] - sy, end[2] - sz);
    const radiusA = Math.max(Number(startRadius) || 0, 0.001);
    const radiusB = Math.max(Number(endRadius) || 0, 0.001);
    if (length < 1e-4) return fitDebugSphere(mesh, start, Math.max(radiusA, radiusB));
    mesh.visible = true;
    if (mesh.userData.debugKind !== 'capsule'
        || Math.abs((mesh.userData.debugLength || 0) - length) > 0.03
        || Math.abs((mesh.userData.debugRadiusA || 0) - radiusA) > 0.01
        || Math.abs((mesh.userData.debugRadiusB || 0) - radiusB) > 0.01) {
        mesh.geometry.dispose();
        mesh.geometry = makeDebugTaperedCapsuleGeometry(length, radiusA, radiusB);
        mesh.userData.debugKind = 'capsule';
        mesh.userData.debugLength = length;
        mesh.userData.debugRadiusA = radiusA;
        mesh.userData.debugRadiusB = radiusB;
    }
    mesh.position.set((sx + end[0]) / 2, (sy + end[1]) / 2, (sz + end[2]) / 2);
    mesh.scale.setScalar(1);
    colliderDebugDir.set(end[0] - sx, end[1] - sy, end[2] - sz).normalize();
    mesh.quaternion.setFromUnitVectors(colliderDebugUp, colliderDebugDir);
}

function updateColliderDebug() {
    colliderDebug.group.visible = colliderDebug.enabled && !!state.model;
    if (!colliderDebug.enabled || !state.model) return;
    const debug = secondaryMotion.debugState();
    resizeDebugPool(colliderDebug.staticMeshes, debug.colliders.length, 0x2bb5a8, 0.8);
    const selectedIndex = colliderDebug.selected === 'all' ? null : Number(colliderDebug.selected);
    debug.colliders.forEach((shape, index) => {
        const mesh = colliderDebug.staticMeshes[index];
        const isSelected = selectedIndex === null || selectedIndex === index;
        mesh.visible = isSelected;
        mesh.material.color.setHex(selectedIndex === null ? 0x2bb5a8 : 0xffc857);
        mesh.material.opacity = selectedIndex === null ? 0.8 : 1;
        if (!isSelected) return;
        if (shape.kind === 'capsule') fitDebugCapsule(mesh, shape.start, shape.end, shape.radiusA, shape.radiusB);
        else fitDebugSphere(mesh, shape.start, shape.radiusA);
    });
    resizeDebugPool(colliderDebug.particleMeshes, debug.particles.length, 0xef765f, 0.45);
    const showParticles = selectedIndex === null;
    debug.particles.forEach((particle, index) => {
        const mesh = colliderDebug.particleMeshes[index];
        mesh.visible = showParticles;
        if (showParticles) fitDebugSphere(mesh, particle.position, particle.radius);
    });
}

function renderColliderDebugSelect() {
    const select = $('#colliderDebugSelect');
    if (!select) return;
    const previous = colliderDebug.selected;
    select.replaceChildren();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = '全部碰撞体';
    select.appendChild(all);
    secondaryMotion.colliders.forEach(({ record }, index) => {
        const option = document.createElement('option');
        const kind = record.kind === 'capsule' || record.type === 1 ? '胶囊' : '球体';
        const radius = (Number(record.radiusA || 0) * 100).toFixed(1);
        const native = Number.isInteger(Number(record.nativeIndex)) ? ` · native#${record.nativeIndex}` : '';
        option.value = String(index);
        option.textContent = `#${String(index + 1).padStart(2, '0')} ${record.bone} · mask ${record.collisionMask} · ${kind} · ${radius}cm${native}`;
        select.appendChild(option);
    });
    const previousIndex = Number(previous);
    const valid = previous === 'all' || Number.isInteger(previousIndex) && previousIndex >= 0 && previousIndex < secondaryMotion.colliders.length;
    colliderDebug.selected = valid ? previous : 'all';
    select.value = colliderDebug.selected;
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
    const modelKey = state.modelFormat === 'glb' ? state.modelFile?.modelKey : '';
    const idol = state.library.config?.idols?.find(item => item.id === idolId);
    secondaryMotion.bind([]);
    colliderDebug.selected = 'all';
    renderColliderDebugSelect();
    updateColliderDebug();
    const glbProfile = state.modelFormat === 'glb';
    if (!supportsSecondaryMotion(idol) && !glbProfile) {
        renderSecondaryMotionStatus();
        return;
    }
    const table = await secondaryMotionReady(glbProfile ? modelKey : idolId, idolId);
    if (generation !== secondaryMotionBindGeneration || state.library.activeIdol !== idolId
        || (state.modelFormat === 'glb' && state.modelFile?.modelKey !== modelKey) || !state.model) return;
    if (!table) {
        renderSecondaryMotionStatus();
        showToast('二次动作参数表载入失败，头发送裙跟随暂不可用', true);
        return;
    }
    if (!state.restPose) return;
    // The HSKI GLB is exported by UnityGLTF and retains Unity's authored
    // skirt driver frame. Its profile coefficients are the raw game values;
    // the GLB path converts them once inside NativeSkirtCalculate. PMX uses a
    // different bone basis, so it keeps the historical adapter.
    secondaryMotion.table = glbProfile
        ? { ...table, skirtDriverBasis: 'gltf-unity', skirtDriverSettingsConverted: false }
        : table;
    // Diagnostics are opt-in. Recording every clothing particle and the full
    // skeleton during normal playback causes a large CPU spike for profiles
    // with many hair/spring nodes. The buttons below still start both traces
    // together when a capture is explicitly requested.
    // The Unity GLB already contains the validated native bind rotations.
    // PMX keeps its historical rest rebase because that model has a different
    // bind frame; applying it to GLB would rotate the hair twice.
    state.hairRestRebase = state.modelFormat === 'glb'
        ? []
        : applyHairRestRotationRebase(state.restPose, table);
    if (state.hairRestRebase.length) refreshRestInverseBinds(state.model);
    secondaryMotion.bind(state.restPose);
    renderColliderDebugSelect();
    renderSecondaryMotionStatus();
    updateColliderDebug();
    if (secondaryMotion.missing.length) {
        const preview = secondaryMotion.missing.slice(0, 6).join('、');
        showToast(`二次动作未绑定 ${secondaryMotion.missing.length} 项：${preview}${secondaryMotion.missing.length > 6 ? ' 等' : ''}`, true);
    }
}

function captureRestPose(model) {
    // A GLB exported from Unity can contain several independent skins:
    // body, face, skirt and one or more hair skins. `model.skeleton` is the
    // animation target selected above (the largest body skeleton), but it is
    // not the complete physics hierarchy. The old path captured only that
    // skeleton, which left all hair/skirt particles and their `_A` drivers
    // outside state.restPose and produced the "未绑定 133 项" warning.
    const bones = [];
    const physicsNodes = [];
    model?.traverse?.(child => {
        if (child.isSkinnedMesh && child.skeleton?.bones) bones.push(...child.skeleton.bones);
        // UnityGLTF keeps some driver/end nodes as ordinary Object3D nodes,
        // not THREE.Bone instances. They still have a local quaternion and
        // are part of the authored secondary-motion hierarchy.
        if (child.name && child.quaternion && !child.isMesh) physicsNodes.push(child);
    });
    if (model?.skeleton?.bones?.length) bones.push(...model.skeleton.bones);
    const uniqueBones = [...new Set(bones)];
    state.skeletonBones = uniqueBones;
    const restNodes = [...new Set([...uniqueBones, ...physicsNodes])];
    state.restPose = restNodes.map(bone => ({
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
    if (state.modelFormat === 'glb') {
        if (!state.animationMixer) {
            // Bind against the GLB root. The exporter can contain several
            // SkinnedMesh objects sharing one skeleton; binding the mixer to
            // only the first mesh can leave valid .bones[...] tracks playing
            // without changing the visible hierarchy.
            state.animationMixer = new THREE.AnimationMixer(state.model);
            state.animationMixer.addEventListener('loop', event => {
                const tracks = event.action.getClip()?.tracks || [];
                if (tracks.length > 0 && !String(tracks[0].name).startsWith('.bones')) return;
                state.animationMixer.looped = true;
            });
        }
        return state.animationMixer;
    }
    const target = state.animationTarget || state.model;
    if (!state.helper.objects.get(target)) {
        state.helper.add(target, {
            physics: false,
            ik: state.modelFormat !== 'glb',
            grant: state.modelFormat !== 'glb',
        });
    }
    const objects = state.helper.objects.get(target);
    if (!objects.mixer) {
        objects.mixer = new THREE.AnimationMixer(target);
        objects.mixer.addEventListener('loop', event => {
            const tracks = event.action.getClip()?.tracks || [];
            if (tracks.length > 0 && !String(tracks[0].name).startsWith('.bones')) return;
            objects.looped = true;
        });
    }
    return objects.mixer;
}

function currentMixer() {
    return state.modelFormat === 'glb'
        ? state.animationMixer
        : state.helper.objects.get(state.animationTarget || state.model)?.mixer;
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

    if (state.modelFormat === 'glb') currentMixer()?.update(0);
    else state.helper.update(0);
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
    const mixer = currentMixer();
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
    const mixer = currentMixer();
    if (!mixer) return;
    state.playing = !state.playing;
    mixer.timeScale = state.playing ? 1 : 0;
    updatePlaybackUi();
}

function applyLoopMode() {
    const item = state.playlistIndex >= 0 ? state.playlist[state.playlistIndex] : null;
    const mixer = currentMixer();
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

function renderSceneOptions() {
    const select = $('#sceneSelect');
    if (!select) return;
    const scenes = state.library.config?.scenes || [];
    select.replaceChildren(new Option('无场景（默认地台）', ''), ...scenes.map(item => new Option(item.name || item.id, item.id)));
}

function renderSceneLayoutOptions() {
    const select = $('#sceneLayout');
    if (!select) return;
    const options = sceneStage.layoutOptions();
    select.replaceChildren(...(options.length ? options.map(item => new Option(item.label, item.id)) : [new Option('先选择场景', '')]));
    select.value = sceneStage.layoutId;
    select.disabled = !options.length;
    $('#sceneCameraBtn').disabled = !options.length;
}

function renderSceneStatus(text) {
    const status = $('#sceneStatus');
    if (!status) return;
    if (text) {
        status.textContent = text;
        return;
    }
    if (!sceneStage.loaded) {
        status.textContent = '场景只作背景，不投射阴影到角色；VN 立绘不受影响。';
        return;
    }
    const volumes = sceneStage.grade?.volumes?.map(path => path.split('/').pop()).join('、') || '无';
    status.textContent = `${sceneStage.sidecar.scene} · 生效后处理体积：${volumes}`;
}

function setStageFloorVisible(visible) {
    floor.visible = visible;
    grid.visible = visible && gridWanted;
}

function syncScenePost() {
    const controls = $('#scenePostControls');
    if (!sceneStage.loaded || !sceneStage.post) {
        postPass.enabled = false;
        postPass.apply(null);
        if (controls) controls.hidden = true;
        return;
    }
    postPass.enabled = true;
    postPass.apply(sceneStage.post);
    if (controls) controls.hidden = false;
    for (const [id, name] of POST_MODULES) {
        const input = $(`#${id}`);
        if (input) input.checked = postPass.modules[name];
    }
}

function applySceneCamera() {
    const view = sceneStage.cameraView();
    if (!view) return;
    camera.position.fromArray(view.position);
    controls.target.fromArray(view.target);
    if (view.fov) camera.fov = view.fov;
    sceneStage.ensureCameraRange(camera);
    camera.updateProjectionMatrix();
    controls.maxDistance = Math.max(60, camera.position.distanceTo(controls.target) * 1.5);
    controls.update();
}

async function selectStageScene(sceneId) {
    const entry = (state.library.config?.scenes || []).find(item => item.id === sceneId);
    const select = $('#sceneSelect');
    if (!entry) {
        sceneStage.unload();
        syncScenePost();
        setStageFloorVisible(true);
        camera.fov = DEFAULT_CAMERA_FOV;
        camera.updateProjectionMatrix();
        controls.maxDistance = 60;
        renderSceneLayoutOptions();
        renderSceneStatus();
        return;
    }
    if (select) select.disabled = true;
    renderSceneStatus(`正在载入 ${entry.name || entry.id}……`);
    setStatus('正在载入场景');
    try {
        const url = libraryFileUrl(state.library.config, entry.pack, entry.path, libraryOverrides());
        const stats = await sceneStage.load(url, { layout: entry.defaultLayout });
        if (!stats) return;
        setStageFloorVisible(false);
        renderSceneLayoutOptions();
        applySceneCamera();
        syncScenePost();
        renderSceneStatus();
        setStatus('场景已载入', 'ready');
        showToast(`已载入场景：${entry.name || entry.id}（${stats.meshes} 个网格，${stats.decals} 个贴花）`);
    } catch (error) {
        console.error('[MMD Stage] scene load failed', error);
        sceneStage.unload();
        syncScenePost();
        setStageFloorVisible(true);
        if (select) select.value = '';
        renderSceneLayoutOptions();
        renderSceneStatus(`场景载入失败：${error.message || error}`);
        setStatus('场景载入失败', 'error');
        showToast(`场景载入失败：${error.message || error}`, true);
    } finally {
        if (select) select.disabled = false;
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    keyLight.target.updateMatrixWorld();
    keyLight.updateMatrixWorld();
    if (state.model) {
        secondaryMotion.restoreBeforeAnimation?.();
        if (state.modelFormat === 'glb') currentMixer()?.update(delta);
        else state.helper.update(delta);
        captureMotionDebugFrame('after-animation');
        harvestFadedActions();
        flushPendingFinish();
        applyPerformanceOverlays();
        state.model.updateMatrixWorld(true);
        captureStageBoneTraceFrame('input');
        // Match HskiHairPortRunner.Update: animation has been sampled above;
        // the fixed-step solver now writes secondary bones before rendering.
        secondaryMotion.update(delta);
        if (secondaryMotion.runtime?.renderFrames % 30 === 0) renderSecondaryMotionStatus();
        captureMotionDebugFrame('after-secondary');
        state.model.updateMatrixWorld(true);
        captureStageBoneTraceFrame('output');
        updateColliderDebug();
    }
    controls.update();
    resizeRenderer();
    sceneStage.ensureCameraRange(camera);
    if (state.materialMode === 'gakumas') {
        state.model?.updateMatrixWorld(true);
        camera.updateMatrixWorld();
        updateGakumasUniforms();
    }
    const draw = () => hairCoverStage.renderFrame(renderer, outlineEffect, scene, camera, state.materialMode === 'gakumas' && state.gakumasPasses.hairCover);
    if (sceneStage.loaded && postPass.active) postPass.render(draw, camera);
    else if (lookPass.enabled) lookPass.render(draw);
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


















