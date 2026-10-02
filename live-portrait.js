import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import {
    MOTION_FADE,
    buildPlaylist,
    classifyClipTracks,
    fadeDurationForClip,
    fadeDurationForTransition,
    findGesturePlaylistIndex,
    findIdlePlaylistIndex,
    indexMotionFiles,
    playlistClipIds,
    sortPlaylistByCatalog,
} from './core.js?v=20260914-idol-types';
import { idolAssetUrls, motionAssetUrls, motionAvailability } from './library-client.js?v=20260913-nested-motion';
import { GAKUMAS_TEXTURE_KINDS, GAKUMAS_ACTIVE_TEXTURE_KINDS, selectMaterialTextures, textureDescriptor, textureUsesColorSpace } from './gakumas-materials.js?v=20260910-shadow1';
import { injectActorShader } from './gakumas-shader.js?v=20261003-hair-cover-fix-v10';
import { actorStencilState, classifyActorPass, placeCharacterShadowLight, shouldCastCharacterShadow, shouldReceiveCharacterShadow } from './gakumas-passes.js?v=20261003-hair-cover-fix-v10';
import { HairCoverStage } from './gakumas-hair-cover.js?v=20261003-hair-cover-fix-v10';
import { GAKUMAS_LOOK, GakumasLookPass, applyGakumasLookUniforms, createGakumasLookUniformValues } from './gakumas-look.js?v=20261002-rim-v1';
import { hasGakumasVertexColorAttribute } from './gakumas-outline.js?v=20260909-outline1';
import {
    LIVE_PORTRAIT_IDOL_ID,
    LIVE_PORTRAIT_PACK,
    canUseLivePortrait,
    isLivePortraitSpeaker,
    shouldPlayLivePortraitTalk,
    shouldShowLivePortrait,
} from './live-portrait-policy.js?v=20260912-multi-idol';
import { parsePortraitCue, selectPortraitPerformance } from './portrait-cues.js?v=20260914-3d-stage-v1';
import { StageAttentionController } from './stage-attention.js?v=20260914-stage-attention-v1';
import { bindVisemeMorphs } from './dialogue-intent.js?v=20260913-numbered';
import { SceneDirector } from './scene-director.js';

export function createSceneDirector(container) {
    return new SceneDirector(container, canvas => new LivePortraitRuntime(canvas));
}
import { SecondaryMotion, applyHairRestRotationRebase, rebaseHairAnimationTracks, refreshRestInverseBinds } from './gakumas-secondary-motion.js?v=20261002-secondary-motion-v42-lilia-skirt-child-chain';

export {
    LIVE_PORTRAIT_IDOL_ID,
    LIVE_PORTRAIT_PACK,
    canUseLivePortrait,
    isLivePortraitSpeaker,
    shouldPlayLivePortraitTalk,
    shouldShowLivePortrait,
};

const LIBRARY_JSON = '/mmd-dialogue-stage/library.json?v=20260911-vn1';
const MOTION_MAP_JSON = '/mmd-dialogue-stage/gakumas-motion-map.json?v=20260910-library1';
const SECONDARY_MOTION_JSON = '/mmd-dialogue-stage/gakumas-secondary-motion.json?v=20260927-native-fixedstep-v3';
const SECONDARY_PROFILE_VERSION = '20261002-secondary-motion-v25-kcna-native-skirt';
const LIBRARY_STATUS = '/mmd-dialogue-stage/library/status?v=20260912-fallback';

let singleton = null;

export function attachLivePortrait(canvas) {
    if (singleton) {
        if (canvas) singleton.adoptCanvas(canvas);
        return singleton;
    }
    singleton = new LivePortraitRuntime(canvas);
    return singleton;
}

export class LivePortraitRuntime {
    constructor(canvas) {
        this.canvas = canvas || null;
        this.libraryReady = false;
        this.available = false;
        this.ready = false;
        this.talking = false;
        this.talkPhase = 0;
        this.visemeBound = {};
        this.paused = true;
        this.config = null;
        this.map = null;
        this.status = null;
        this.indexByPack = new Map();
        this.model = null;
        this.helper = new MMDAnimationHelper({ afterglow: 0, sync: true });
        this.secondaryMotion = new SecondaryMotion();
        this.secondaryMotionReady = null;
        this.secondaryMotionBound = false;
        this.actions = new Map();
        this.playlist = [];
        this.playlistIndex = -1;
        this.liveActions = [];
        this.fadingActions = [];
        this.finishedHandler = null;
        this.playGeneration = 0;
        this.frameId = 0;
        this.clock = new THREE.Clock();
        this.gakumasHeadBone = null;
        this.gakumasHeadRight = new THREE.Vector3(1, 0, 0);
        this.gakumasLightDirection = new THREE.Vector3();
        this.gakumasTextures = [];
        this.gakumasFallbacks = {};
        this.gakumasUniforms = new Set();
        this.hairCoverStage = new HairCoverStage();
        this.shadowStrength = GAKUMAS_LOOK.shadow;
        this.gakumasPasses = { characterShadow: true, hairCover: true, hairCoverMinimum: 0.35 };
        this.outline = { color: '#000000', alpha: 0.82, thickness: 0.004 };
        this.characterCenter = new THREE.Vector3(0, 8, 0);
        this.characterShadowFit = { center: new THREE.Vector3(0, 8, 0), radius: 10 };
        this.renderer = null;
        this.outlineEffect = null;
        this.lookPass = null;
        this.scene = null;
        this.camera = null;
        this.attention = new StageAttentionController();
        this.hemi = null;
        this.keyLight = null;
        this.keyPointLight = null;
        this.rimLight = null;
        this.characterShadowLight = null;
        this.ensurePromise = null;
        if (canvas) this.setupRenderer(canvas);
    }

    adoptCanvas(canvas) {
        if (!canvas || this.canvas === canvas) return;
        this.disposeRenderer();
        this.canvas = canvas;
        this.setupRenderer(canvas);
        if (this.model && this.scene) this.scene.add(this.model);
        this.frameVnCamera();
        this.resize();
    }

    setupRenderer(canvas) {
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        if ('outputColorSpace' in this.renderer && THREE.SRGBColorSpace) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.toneMappingExposure = 1;
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.outlineEffect = new OutlineEffect(this.renderer, {
            defaultThickness: this.outline.thickness,
            defaultColor: [0, 0, 0],
            defaultAlpha: this.outline.alpha,
            defaultKeepAlive: true,
        });
        this.lookPass = new GakumasLookPass(this.renderer);
        this.lookPass.enabled = true;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1000);
        this.hemi = new THREE.HemisphereLight(0xdce8ff, 0x6d7777, GAKUMAS_LOOK.hemi);
        this.keyLight = new THREE.DirectionalLight(GAKUMAS_LOOK.keyColor, GAKUMAS_LOOK.key);
        this.keyLight.position.set(8, 16, 10);
        this.keyLight.target.position.copy(this.characterCenter);
        this.keyPointLight = new THREE.PointLight(GAKUMAS_LOOK.keyColor, GAKUMAS_LOOK.key * 0.05, 0, 0);
        this.rimLight = new THREE.DirectionalLight(0xffffff, 1);
        this.rimLight.position.set(-8, 10, -7);
        this.characterShadowLight = new THREE.DirectionalLight(0xffffff, 0);
        this.characterShadowLight.castShadow = true;
        this.characterShadowLight.shadow.mapSize.set(4096, 4096);
        this.characterShadowLight.shadow.bias = 0;
        this.characterShadowLight.shadow.normalBias = 0;
        this.characterShadowLight.shadow.radius = 0;
        this.characterShadowLight.userData.gakumasCharacterShadow = true;
        this.scene.add(this.hemi, this.keyLight.target, this.keyLight, this.keyPointLight, this.rimLight, this.characterShadowLight.target, this.characterShadowLight);
        this.applyKeyLight(GAKUMAS_LOOK.keyAzimuth, GAKUMAS_LOOK.keyElevation);
    }

    disposeRenderer() {
        this.stopLoop();
        this.lookPass?.dispose();
        this.lookPass = null;
        this.outlineEffect = null;
        this.renderer?.dispose();
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.hemi = null;
        this.keyLight = null;
        this.keyPointLight = null;
        this.rimLight = null;
        this.characterShadowLight = null;
    }

    async prepare() {
        if (this.libraryReady) return this.available;
        try {
            const [config, map, statusRes] = await Promise.all([
                fetch(LIBRARY_JSON).then(response => {
                    if (!response.ok) throw new Error(response.statusText);
                    return response.json();
                }),
                fetch(MOTION_MAP_JSON).then(response => {
                    if (!response.ok) throw new Error(response.statusText);
                    return response.json();
                }),
                fetch(LIBRARY_STATUS),
            ]);
            this.config = config;
            this.map = map;
            this.status = statusRes.ok ? await statusRes.json() : null;
            this.indexByPack = new Map(Object.entries(this.status?.packs || {}).map(([packId, pack]) => [packId, indexMotionFiles(pack.files || [])]));
            this.available = this.config.idols.length > 0 && (
                !this.status?.packs || Boolean(this.status?.packs?.[LIVE_PORTRAIT_PACK]?.available)
            );
        } catch (error) {
            console.warn('[LivePortrait] library unavailable', error);
            this.available = false;
        }
        this.libraryReady = true;
        return this.available;
    }

    canUse(idolId = LIVE_PORTRAIT_IDOL_ID) {
        const idol = this.config?.idols?.find(item => item.id === idolId);
        if (!idol) return false;
        if (!this.status?.packs) return true;
        return Boolean(this.status.packs[idol.pack]?.available);
    }

    async ensure(idolId = LIVE_PORTRAIT_IDOL_ID) {
        if (this.ready && this.model) return this.idolId === idolId;
        if (this.ensurePromise) return this.ensurePromise;
        this.ensurePromise = this.loadIdol(idolId).finally(() => {
            this.ensurePromise = null;
        });
        return this.ensurePromise;
    }

    async loadIdol(idolId) {
        await this.prepare();
        if (!this.canUse(idolId) || !this.canvas || !this.renderer) return false;
        const idol = this.config?.idols?.find(item => item.id === idolId);
        if (!idol) return false;
        this.idolId = idolId;
        const packFiles = this.status?.packs?.[idol.pack]?.files || [];
        const textureNames = packFiles
            .filter(name => !idol.textureDir || name.startsWith(`${idol.textureDir}/`) || !name.includes('/'))
            .map(name => name.split('/').pop());
        const assets = idolAssetUrls(idol, this.config, textureNames.filter(name => /\.(png|jpe?g|webp)$/i.test(name)));
        const { loader } = this.createModelLoader(idol, assets.textures || []);
        const model = await new Promise((resolve, reject) => loader.load(assets.modelUrl, resolve, undefined, reject));
        this.model = model;
        this.attention.bind(model);
        this.gakumasHeadBone = null;
        model.traverse(child => {
            if (!this.gakumasHeadBone && child.isBone && /^(?:head|頭|頭部)$/i.test(child.name)) this.gakumasHeadBone = child;
            if (child.isMesh) {
                child.castShadow = false;
                child.receiveShadow = false;
            }
        });
        this.scene.add(model);
        await this.waitForModelTextures(model);
        await this.loadGakumasTextures(assets.textures || []);
        this.applyGakumasMaterials();
        this.bindVisemeMorphs(idol);
        this.helper.add(model, { physics: false });
        await this.bindSecondaryMotion(model);
        this.frameVnCamera();
        await this.ensureFamily('idle', { play: true });
        this.ready = Boolean(this.model);
        return this.ready;
    }

    bindVisemeMorphs(idol) {
        const names = [];
        this.model?.traverse(child => {
            if (child.isMesh && child.morphTargetDictionary) names.push(...Object.keys(child.morphTargetDictionary));
        });
        this.visemeBound = bindVisemeMorphs([...new Set(names)], idol?.visemes || {});
    }

    updateTalkingMorph(delta) {
        if (!this.model || !this.talking) return;
        this.talkPhase += delta * 9;
        const weight = 0.18 + (Math.sin(this.talkPhase) * 0.5 + 0.5) * 0.48;
        const targets = [...(this.visemeBound.A || []), ...(this.visemeBound.I || [])];
        for (const target of targets) {
            this.model.traverse(child => {
                const index = child.morphTargetDictionary?.[target.name];
                if (Number.isInteger(index) && child.morphTargetInfluences) child.morphTargetInfluences[index] = weight * (target.weight || 1);
            });
        }
    }

    async bindSecondaryMotion(model) {
        if (!model) return false;
        try {
            if (!this.secondaryMotionReady) {
                this.secondaryMotionReady = fetch(`/mmd-dialogue-stage/secondary-motion-profiles/${encodeURIComponent(this.idolId || LIVE_PORTRAIT_IDOL_ID)}.json?v=${SECONDARY_PROFILE_VERSION}`).then(response => {
                    if (response.status === 404) return fetch(SECONDARY_MOTION_JSON); 
                    if (!response.ok) throw new Error(response.statusText);
                    return response.json();
                });
            }
            const table = await this.secondaryMotionReady;
            const bones = [];
            model.traverse(child => {
                if (child.isBone) bones.push(child);
            });
            this.secondaryMotion.table = table;
            const restPose = bones.map(bone => ({ bone }));
            this.hairRestRebase = applyHairRestRotationRebase(restPose, table);
            if (this.hairRestRebase.length) refreshRestInverseBinds(model);
            this.secondaryMotion.bind(bones.map(bone => ({
                bone,
                position: bone.position.clone(),
                quaternion: bone.quaternion.clone(),
                scale: bone.scale.clone(),
            })));
            this.secondaryMotionBound = true;
            return true;
        } catch (error) {
            console.warn('[LivePortrait] secondary motion unavailable', error);
            this.secondaryMotionBound = false;
            return false;
        }
    }

    catalogItems() {
        const buckets = this.map?.buckets || [];
        return buckets.flatMap(bucket => bucket.families.flatMap(family => family.items.map(item => ({
            ...item,
            key: item.stem,
            catalog: {
                bucket: bucket.id,
                family: family.id,
                pairing: item.pairing,
                character: item.character,
                phase: item.phase,
                additive: item.additive,
            },
        })))).filter(item => ['cmmn', this.idolId || LIVE_PORTRAIT_IDOL_ID].includes(item.character));
    }

    async ensureFamily(family, { play = false, skipFace = false, preferPairing = '', preferPhase = '' } = {}) {
        if (!this.model) return -1;
        const catalog = this.catalogItems();
        let index = -1;
        if (family === 'idle') {
            index = findIdlePlaylistIndex(catalog, this.idolId || LIVE_PORTRAIT_IDOL_ID);
        } else {
            index = findGesturePlaylistIndex(catalog, family, this.idolId || LIVE_PORTRAIT_IDOL_ID, {
                preferPairing: preferPairing || (skipFace ? 'bodyOnly' : 'paired'),
            });
            if (preferPhase && index >= 0) {
                const selected = catalog[index];
                const preferred = catalog.findIndex((item, itemIndex) => {
                    const familyId = item.catalog?.family || item.family || '';
                    return (familyId === family || familyId.startsWith(`${family}-`))
                        && (item.catalog?.phase || item.phase) === preferPhase
                        && (item.catalog?.variant || item.variant || '') === (selected.catalog?.variant || selected.variant || '')
                        && (item.catalog?.character || item.character) === (selected.catalog?.character || selected.character)
                        && (!preferPairing || (item.catalog?.pairing || item.pairing) === preferPairing);
                });
                if (preferred >= 0) index = preferred;
            }
        }
        if (index < 0) return -1;
        const item = catalog[index];
        const files = motionAssetUrls(item, this.config, this.indexByPack);
        if (!files.length) return -1;
        await this.importMotionEntries(files.map(file => ({
            id: file.id,
            label: item.label,
            url: file.url,
            name: file.name,
        })));
        const playlistIndex = this.playlist.findIndex(entry => entry.key === (item.stem || item.key)
            || playlistClipIds(entry).some(id => files.some(file => file.id === id)));
        if (play && playlistIndex >= 0) this.playPlaylistIndex(playlistIndex, { skipFace, fade: MOTION_FADE.standing });
        return playlistIndex;
    }

    cancelPerformance() {
        this.performanceGeneration = (this.performanceGeneration || 0) + 1;
    }

    async playStageTransition(family, { signal, isCurrent = () => true, onStart = () => {} } = {}) {
        this.cancelPerformance();
        this.performanceKey = '';
        const index = await this.ensureFamily(family, { play: false });
        if (signal?.aborted || !isCurrent()) return false;
        if (index < 0) {
            console.warn(`[LivePortrait] transition unavailable`, family, this.idolId);
            return false;
        }

        if (!this.prepareStageFirstFrame(index)) return false;
        if (signal?.aborted || !isCurrent()) return false;
        onStart();
        const mixer = this.ensureMixer();
        const clips = this.liveActions.map(action => action.getClip());
        const longest = clips.reduce((left, right) => right.duration > left.duration ? right : left);
        return new Promise(resolve => {
            const finish = result => {
                mixer.removeEventListener('finished', handler);
                signal?.removeEventListener('abort', abort);
                resolve(result);
            };
            const handler = event => { if (event.action.getClip() === longest) finish(true); };
            const abort = () => finish(false);
            mixer.addEventListener('finished', handler);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
        });
    }

    async playSpeakerCue(speaker, { slideType = '', isCurrent = () => true } = {}) {
        this.cancelPerformance();
        const generation = this.performanceGeneration;
        let cue = parsePortraitCue(speaker, slideType, this.idolId || LIVE_PORTRAIT_IDOL_ID);
        if (!cue || !this.ready) return false;
        if (cue.mode === 'keep') {
            if (this.performanceKey) return true;
            cue = parsePortraitCue('藤田琴音(待机)');
        }
        const key = `${cue.mode}:${cue.gesture}:${cue.face}`;
        if (key === this.performanceKey) return true;
        const catalog = this.catalogItems().filter(item => motionAvailability(item, this.indexByPack).ready);
        const item = selectPortraitPerformance(cue, catalog, this.idolId || LIVE_PORTRAIT_IDOL_ID);
        if (!item) return false;
        const files = motionAssetUrls(item, this.config, this.indexByPack);
        if (files.length !== 2 || files.some(file => file.guessed)) return false;
        await this.importMotionEntries(files.map(file => ({ ...file, label: item.label })));
        if (generation !== this.performanceGeneration || !isCurrent()) return false;
        this.performanceClips ||= new Map();
        const clips = files.map(file => {
            const cacheKey = `${file.id}:${file.kind}`;
            if (!this.performanceClips.has(cacheKey)) {
                const source = this.actions.get(file.id)?.clip;
                if (!source) return null;
                const tracks = source.tracks.filter(track => /\.morphTargetInfluences\[/.test(track.name) === (file.kind === 'face'));
                if (!tracks.length) return null;
                const clip = new THREE.AnimationClip(cacheKey, source.duration, tracks.map(track => track.clone()));
                this.performanceClips.set(cacheKey, { id: file.id, kind: file.kind, clip });
            }
            return this.performanceClips.get(cacheKey);
        });
        if (clips.some(clip => !clip)) return false;
        const played = this.playPlaylistIndex(-1, { item, clips, fade: MOTION_FADE.standing });
        if (played) this.performanceKey = key;
        return played;
    }

    async importMotionEntries(entries) {
        const loader = new MMDLoader();
        for (const entry of entries) {
            if (this.actions.has(entry.id)) continue;
            try {
                const clip = await new Promise((resolve, reject) => loader.loadAnimation(entry.url, this.model, resolve, undefined, reject));
                rebaseHairAnimationTracks(clip, this.hairRestRebase);
                clip.name = entry.id;
                const { kind } = classifyClipTracks(clip.tracks.map(track => track.name));
                this.actions.set(entry.id, { id: entry.id, label: entry.label || entry.id, clip, kind });
            } catch (error) {
                console.warn('[LivePortrait] motion failed', entry.id, error);
            }
        }
        this.playlist = sortPlaylistByCatalog(buildPlaylist([...this.actions.values()].map(({ id, label, kind }) => ({ id, label, kind }))));
    }

    playPlaylistIndex(index, options = {}) {
        const item = options.item || this.playlist[index];
        if (!item || !this.model) return false;
        const fromItem = this.playlistIndex >= 0 ? this.playlist[this.playlistIndex] : null;
        let ids = playlistClipIds(item);
        if (options.skipFace) ids = ids.filter(id => this.actions.get(id)?.kind === 'body' || id === item.body);
        const clips = options.clips || ids.map(id => ({ id, clip: this.actions.get(id)?.clip, kind: this.actions.get(id)?.kind || '' })).filter(entry => entry.clip);
        if (!clips.length) return false;
        const mixer = this.ensureMixer();
        if (!mixer) return false;
        mixer.timeScale = 1;
        const bodyFade = options.fade ?? (this.liveActions.length ? fadeDurationForTransition(fromItem, item) : 0);
        const loop = false;
        this.clearFinishedHandler(mixer);
        const nextActions = clips.map(({ clip }) => mixer.clipAction(clip));
        const keep = new Set(nextActions);
        const outgoing = this.liveActions.filter(action => !keep.has(action));
        for (const action of outgoing) {
            action.enabled = true;
            if (bodyFade > 0) {
                action.fadeOut(bodyFade);
                if (!this.fadingActions.includes(action)) this.fadingActions.push(action);
            } else action.stop();
        }
        for (const { clip, kind } of clips) {
            const action = mixer.clipAction(clip);
            const fade = fadeDurationForClip(kind, bodyFade);
            action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
            action.clampWhenFinished = true;
            action.enabled = true;
            if (!this.liveActions.includes(action) || options.restart) action.reset();
            action.setEffectiveWeight(1);
            action.play();
            if (bodyFade > 0 && fade > 0 && !this.liveActions.includes(action)) action.fadeIn(fade);
        }
        this.helper.update(0);
        this.liveActions = nextActions;
        this.playlistIndex = index;
        this.playGeneration += 1;
        if (!loop) this.attachClipFinished(mixer, clips.map(entry => entry.clip), item, this.playGeneration);
        return true;
    }

    prepareStageFirstFrame(index) {
        const played = this.playPlaylistIndex(index, { fade: 0, restart: true });
        if (!played) return false;
        const mixer = this.ensureMixer();
        if (!mixer) return false;
        mixer.timeScale = 1;
        this.helper.update(0);
        this.model?.updateMatrixWorld(true);
        if (this.secondaryMotionBound) {
            this.secondaryMotion.reset();
            this.model?.updateMatrixWorld(true);
        }
        this.resize();
        this.frameVnCamera();
        this.renderFrame();
        return true;
    }

    clearFinishedHandler(mixer) {
        if (mixer && this.finishedHandler) mixer.removeEventListener('finished', this.finishedHandler);
        this.finishedHandler = null;
    }

    attachClipFinished(mixer, clips, item, generation) {
        if (!mixer || !clips.length) return;
        const longest = clips.reduce((left, right) => (right.duration > left.duration ? right : left));
        const handler = event => {
            if (this.playGeneration !== generation || event.action.getClip() !== longest) return;
            this.clearFinishedHandler(mixer);
            mixer.timeScale = 0;
            this.talking = false;
        };
        this.finishedHandler = handler;
        mixer.addEventListener('finished', handler);
    }

    ensureMixer() {
        if (!this.model) return null;
        if (!this.helper.objects.get(this.model)) this.helper.add(this.model, { physics: false });
        const objects = this.helper.objects.get(this.model);
        if (!objects.mixer) objects.mixer = new THREE.AnimationMixer(this.model);
        return objects.mixer;
    }

    setAttentionTarget(targetId, vector, duration = 0) {
        if (!targetId || targetId === 'camera' || targetId === 'none') this.attention.clearTarget();
        else this.attention.setTarget(targetId, vector, duration);
    }

    updateAttention(delta) { this.attention.update(delta); }

    async setTalking(talking) {
        this.talking = Boolean(talking);
        if (!this.talking) this.talkPhase = 0;
    }

    show() {
        this.resume();
    }

    hide() {
        this.pause();
    }

    pause() {
        this.cancelPerformance();
        this.paused = true;
        this.stopLoop();
    }

    resume() {
        if (!this.ready) return;
        this.paused = false;
        this.clock.getDelta();
        this.startLoop();
        this.resize();
        this.frameVnCamera();
    }

    startLoop() {
        if (this.frameId) return;
        const tick = () => {
            if (this.paused) {
                this.frameId = 0;
                return;
            }
            this.frameId = requestAnimationFrame(tick);
            const delta = Math.min(this.clock.getDelta(), 0.05);
            if (this.model) {
                this.secondaryMotion?.restoreBeforeAnimation?.();
                this.helper.update(delta);
                if (this.secondaryMotionBound) this.secondaryMotion.update(delta);
                this.updateAttention(delta);
                this.updateTalkingMorph(delta);
                this.harvestFades();
                this.model.updateMatrixWorld(true);
            }
            this.resize();
            this.camera.updateMatrixWorld();
            this.updateGakumasUniforms();
            const draw = () => this.hairCoverStage.renderFrame(
                this.renderer,
                this.outlineEffect,
                this.scene,
                this.camera,
                this.gakumasPasses.hairCover,
            );
            if (this.lookPass?.enabled) this.lookPass.render(draw);
            else draw();
        };
        this.frameId = requestAnimationFrame(tick);
    }

    renderFrame() {
        this.resize();
        this.camera.updateMatrixWorld();
        this.updateGakumasUniforms();
        const draw = () => this.hairCoverStage.renderFrame(this.renderer, this.outlineEffect, this.scene, this.camera, this.gakumasPasses.hairCover);
        if (this.lookPass?.enabled) this.lookPass.render(draw);
        else draw();
    }

    stopLoop() {
        if (this.frameId) cancelAnimationFrame(this.frameId);
        this.frameId = 0;
    }

    harvestFades() {
        if (!this.fadingActions.length) return;
        const next = [];
        for (const action of this.fadingActions) {
            if (this.liveActions.includes(action)) continue;
            if (action.enabled && action.getEffectiveWeight() > 0.01) next.push(action);
            else action.stop();
        }
        this.fadingActions = next;
    }

    frameVnCamera() {
        if (!this.model || !this.camera) return;
        const box = new THREE.Box3().setFromObject(this.model);
        if (box.isEmpty()) return;
        const size = box.getSize(new THREE.Vector3());
        const height = Math.max(size.y, 1);
        const center = box.getCenter(new THREE.Vector3());
        const target = new THREE.Vector3(center.x, box.min.y + height * 0.52, center.z);
        this.characterCenter.copy(target);
        this.characterShadowFit.center.copy(center);
        this.characterShadowFit.radius = Math.max(size.length() * 0.55, 4);
        const distance = height * 1.72;
        this.camera.fov = 36;
        this.camera.position.set(target.x + height * 0.06, target.y + height * 0.02, target.z + distance);
        this.camera.near = Math.max(0.05, height / 100);
        this.camera.far = Math.max(height * 80, distance * 4);
        this.camera.lookAt(target);
        this.camera.updateProjectionMatrix();
        this.applyKeyLight(GAKUMAS_LOOK.keyAzimuth, GAKUMAS_LOOK.keyElevation);
        this.updateGakumasUniforms();
    }

    applyKeyLight(azimuth, elevation) {
        if (!this.keyLight) return;
        const azimuthRad = THREE.MathUtils.degToRad(azimuth);
        const elevationRad = THREE.MathUtils.degToRad(elevation);
        const direction = new THREE.Vector3(
            Math.sin(azimuthRad) * Math.cos(elevationRad),
            Math.sin(elevationRad),
            Math.cos(azimuthRad) * Math.cos(elevationRad),
        );
        this.keyLight.target.position.copy(this.characterCenter);
        this.keyLight.position.copy(this.characterCenter).addScaledVector(direction, 20);
        this.keyPointLight.position.copy(this.keyLight.position);
        this.keyLight.target.updateMatrixWorld();
        this.keyLight.updateMatrixWorld();
    }

    resize() {
        if (!this.canvas || !this.renderer || !this.camera) return;
        const width = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 0;
        const height = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 0;
        if (!width || !height) return;
        const pixelRatio = this.renderer.getPixelRatio();
        if (this.canvas.width !== Math.floor(width * pixelRatio) || this.canvas.height !== Math.floor(height * pixelRatio)) {
            this.renderer.setSize(width, height, false);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
    }

    createModelLoader(idol, textures) {
        const byName = new Map();
        for (const tex of textures) {
            const name = String(tex.name || '').replace(/\\/g, '/').toLowerCase();
            if (!name || !tex.url) continue;
            const file = name.split('/').pop();
            byName.set(name, tex.url);
            byName.set(file, tex.url);
            if (idol.textureDir) byName.set(`${String(idol.textureDir).replace(/\\/g, '/').toLowerCase()}/${file}`, tex.url);
        }
        const resolveTextureUrl = resource => {
            const raw = String(resource || '');
            if (!raw || raw.startsWith('data:')) return raw;
            let path = raw;
            try { path = decodeURIComponent(new URL(raw, window.location.href).pathname); } catch { /* keep */ }
            const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
            const file = normalized.split('/').pop();
            if (byName.has(normalized)) return byName.get(normalized);
            if (byName.has(file)) return byName.get(file);
            for (const [key, url] of byName.entries()) {
                if (normalized.endsWith(`/${key}`)) return url;
            }
            return raw.replace(/\\/g, '/');
        };
        const manager = new THREE.LoadingManager();
        manager.setURLModifier(resolveTextureUrl);
        const loader = new MMDLoader(manager);
        loader._extractExtension = () => 'pmx';
        return { loader, resolveTextureUrl };
    }

    waitForModelTextures(model, timeoutMs = 8000) {
        const textures = new Set();
        model?.traverse(child => {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.filter(Boolean).forEach(material => {
                for (const key of ['map', 'matcap', 'gradientMap']) {
                    if (material[key]) textures.add(material[key]);
                }
            });
        });
        if (!textures.size) return Promise.resolve();
        return Promise.race([
            Promise.all([...textures].map(texture => new Promise(resolve => {
                if (texture.image?.complete || texture.image?.data || texture.isCompressedTexture) {
                    resolve();
                    return;
                }
                if (Array.isArray(texture.readyCallbacks)) {
                    texture.readyCallbacks.push(() => resolve());
                    return;
                }
                const image = texture.image;
                if (image && typeof image.addEventListener === 'function') {
                    image.addEventListener('load', () => resolve(), { once: true });
                    image.addEventListener('error', () => resolve(), { once: true });
                    return;
                }
                resolve();
            }))),
            new Promise(resolve => setTimeout(resolve, timeoutMs)),
        ]);
    }

    async loadGakumasTextures(files) {
        const unique = new Map();
        for (const file of files) {
            const name = file.name || '';
            const descriptor = textureDescriptor(name);
            if (!GAKUMAS_TEXTURE_KINDS.includes(descriptor.kind)) continue;
            unique.set(`${file.url || ''}:${name}`, { ...descriptor, url: file.url, name });
        }
        const entries = [];
        for (const entry of unique.values()) {
            if (GAKUMAS_ACTIVE_TEXTURE_KINDS.includes(entry.kind) && entry.url) {
                try {
                    entry.texture = await new THREE.TextureLoader().loadAsync(entry.url);
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
                    console.warn('[LivePortrait] Gakumas texture failed', entry.name, error);
                }
            }
            entries.push(entry);
        }
        this.gakumasTextures.forEach(entry => entry.texture?.dispose());
        this.gakumasTextures = entries;
    }

    gakumasFallback(kind) {
        if (!this.gakumasFallbacks[kind]) {
            const pixel = kind === 'def' ? [128, 0, 0, 0] : [255, 255, 255, 0];
            const texture = new THREE.DataTexture(new Uint8Array(pixel), 1, 1, THREE.RGBAFormat);
            texture.needsUpdate = true;
            this.gakumasFallbacks[kind] = texture;
        }
        return this.gakumasFallbacks[kind];
    }

    createGakumasUniforms() {
        return {
            gkShadeMap: { value: this.gakumasFallback('shade') },
            gkDefMap: { value: this.gakumasFallback('def') },
            gkRampMap: { value: this.gakumasFallback('ramp') },
            gkHighlightMap: { value: this.gakumasFallback('highlight') },
            gkRampAddMap: { value: this.gakumasFallback('rampAdd') },
            gkHasShade: { value: 0 },
            gkHasRamp: { value: 0 },
            gkHasHighlight: { value: 0 },
            gkHasRampAdd: { value: 0 },
            gkRampAddColor: { value: new THREE.Color(0xffffff) },
            gkLightDirection: { value: new THREE.Vector3(0.3, 0.6, 0.7) },
            gkLightColor: { value: new THREE.Color(0xffffff) },
            gkLightStrength: { value: GAKUMAS_LOOK.key },
            gkShadowStrength: { value: this.shadowStrength },
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

    applyGakumasMaterials() {
        if (!this.model) return;
        this.hairCoverStage.dispose();
        this.gakumasUniforms.clear();
        this.model.traverse(child => {
            if (!child.isMesh) return;
            let hasCharacterShadowCaster = false;
            child.userData.gakumasShadowMaterialMask = [];
            this.applyOutline(child.material, child);
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material, materialIndex) => {
                if (!material?.isMMDToonMaterial) return;
                if (material.map && 'colorSpace' in material.map && THREE.SRGBColorSpace) {
                    material.map.colorSpace = THREE.SRGBColorSpace;
                }
                const selection = selectMaterialTextures(material, this.gakumasTextures);
                material.userData.gakumasSelection = selection;
                const uniforms = material.userData.gakumasUniforms || this.createGakumasUniforms();
                material.userData.gakumasUniforms = uniforms;
                for (const kind of GAKUMAS_ACTIVE_TEXTURE_KINDS) {
                    const uniformName = `gk${kind[0].toUpperCase()}${kind.slice(1)}Map`;
                    uniforms[uniformName].value = selection.bindings[kind]?.texture || this.gakumasFallback(kind);
                }
                uniforms.gkHasShade.value = selection.bindings.shade?.texture ? 1 : 0;
                uniforms.gkHasRamp.value = selection.bindings.ramp?.texture ? 1 : 0;
                uniforms.gkHasHighlight.value = selection.bindings.highlight?.texture ? 1 : 0;
                uniforms.gkRampAddMap.value = selection.bindings.rampAdd?.texture || this.gakumasFallback('rampAdd');
                this.gakumasUniforms.add(uniforms);
                const role = selection.descriptor.role;
                const actorPass = classifyActorPass(material.name, selection.descriptor.name);
                child.userData.gakumasShadowMaterialMask[materialIndex] = shouldCastCharacterShadow(actorPass);
                uniforms.gkCharacterShadowReceive.value = shouldReceiveCharacterShadow(actorPass) ? 1 : 0;
                const rampAddAllowed = ['body', 'bodyAccessory', 'clothing', 'face'].includes(role);
                uniforms.gkHasRampAdd.value = selection.bindings.rampAdd?.texture && rampAddAllowed ? 1 : 0;
                const baseBlending = material.userData.gakumasBaseBlending ?? material.blending;
                material.userData.gakumasBaseBlending = baseBlending;
                const hairTextureName = material.userData?.MMD?.mapFileName || selection.descriptor.name;
                const isEyeLayer = material.name.toLowerCase() === 'm_eye' || actorPass === 'eye';
                material.userData.gakumasAlphaLayer = false;
                material.userData.gakumasOutlineAlphaExcluded = !isEyeLayer && /(?:_alp|_alpha)(?:\.|_|$)/i.test(hairTextureName);
                material.userData.gakumasEyeLayer = isEyeLayer;
                material.userData.gakumasActorPass = actorPass;
                const shadowCaster = shouldCastCharacterShadow(actorPass);
                material.receiveShadow = false;
                hasCharacterShadowCaster ||= shadowCaster;
                material.lights = true;
                material.defaultAttributeValues = {
                    ...(material.defaultAttributeValues || {}),
                    gakumasVertexColor: [0, 0, 0, 0],
                };
                const baseDefines = { ...(material.defines || {}) };
                delete baseDefines.GK_HAIR_COVER;
                material.defines = { ...baseDefines, GK_HAIR: role === 'hair' || actorPass === 'hairHighlight', GK_HAIR_HIGHLIGHT_PASS: actorPass === 'hairHighlight', GK_FACE: role === 'face', GK_EYE: role === 'eye' || actorPass === 'eyeHighlight' };
                material.userData.gakumasBaseTransparent ??= material.transparent;
                material.transparent = material.userData.gakumasBaseTransparent;
                material.blending = baseBlending;
                material.premultipliedAlpha = false;
                material.depthTest = true;
                material.renderOrder = material.userData.gakumasBaseRenderOrder ?? material.renderOrder;
                material.depthWrite = actorPass !== 'eye' && actorPass !== 'eyeHighlight';
                if (isEyeLayer) material.renderOrder = 30;
                material.alphaTest = actorPass === 'eye' || actorPass === 'eyeHighlight' ? 0 : 0.33;
                material.side = THREE.FrontSide;
                material.colorWrite = true;
                if ('toneMapped' in material) material.toneMapped = false;
                this.applyStencil(material, actorStencilState(material.name, actorPass));
                material.onBeforeCompile = shader => injectActorShader(shader, uniforms);
                material.customProgramCacheKey = () => `gakumas-v2:gakumas:${role}:rim-v1`;
                material.needsUpdate = true;
                material.visible = true;
                this.hairCoverStage.add(child, material, materialIndex, uniforms, hairTextureName);
                if (actorPass === 'hairHighlight') this.hairCoverStage.addHighlight(child, material, materialIndex);
            });
            child.castShadow = hasCharacterShadowCaster;
            child.receiveShadow = false;
        });
        this.updateGakumasUniforms();
    }

    applyStencil(material, state) {
        material.stencilWrite = state.write;
        material.stencilFunc = THREE[state.func] ?? THREE.AlwaysStencilFunc;
        material.stencilRef = state.ref;
        material.stencilFuncMask = state.readMask;
        material.stencilWriteMask = state.writeMask;
        material.stencilFail = THREE[state.fail] ?? THREE.KeepStencilOp;
        material.stencilZFail = THREE[state.zFail] ?? THREE.KeepStencilOp;
        material.stencilZPass = THREE[state.zPass] ?? THREE.KeepStencilOp;
    }

    updateGakumasUniforms() {
        if (!this.gakumasUniforms.size || !this.keyLight || !this.camera) return;
        const direction = this.gakumasLightDirection.copy(this.keyLight.position).sub(this.keyLight.target.position).normalize();
        const axis = this.gakumasHeadBone || this.model;
        this.hairCoverStage.update(axis, this.gakumasPasses.hairCoverMinimum);
        if (axis) this.gakumasHeadRight.setFromMatrixColumn(axis.matrixWorld, 0).normalize();
        const shadowLight = this.characterShadowLight;
        const characterShadow = placeCharacterShadowLight(shadowLight, this.camera, this.characterShadowFit);
        this.gakumasUniforms.forEach(uniforms => {
            uniforms.gkLightDirection.value.copy(direction);
            uniforms.gkLightColor.value.copy(this.keyLight.color);
            uniforms.gkLightStrength.value = this.keyLight.intensity;
            uniforms.gkRimColor.value.copy(this.rimLight.color);
            uniforms.gkRimStrength.value = this.rimLight.intensity;
            uniforms.gkShadowStrength.value = this.shadowStrength;
            uniforms.gkHeadRight.value.copy(this.gakumasHeadRight);
            uniforms.gkCharacterShadowEnabled.value = this.gakumasPasses.characterShadow && shadowLight?.shadow.map ? 1 : 0;
            uniforms.gkCharacterShadowMap.value = shadowLight?.shadow.map?.texture || null;
            if (shadowLight) uniforms.gkCharacterShadowMatrix.value.copy(shadowLight.shadow.matrix);
            uniforms.gkCharacterShadowContact.value = characterShadow?.contact || 0.001;
            applyGakumasLookUniforms(uniforms);
        });
    }

    applyOutline(material, mesh) {
        const materials = Array.isArray(material) ? material : [material];
        materials.filter(Boolean).forEach(item => {
            if (!item.userData.mmdOutlineParameters && item.userData.outlineParameters) {
                const source = item.userData.outlineParameters;
                item.userData.mmdOutlineParameters = {
                    visible: source.visible,
                    thickness: source.thickness,
                    color: Array.isArray(source.color) ? source.color.slice(0, 3) : undefined,
                    alpha: source.alpha,
                };
            }
            item.userData.gakumasVertexColorEnabled = hasGakumasVertexColorAttribute(mesh);
            const name = `${mesh?.name || ''} ${item.name || ''}`.toLowerCase();
            const excluded = /(?:eye|eyeball|iris|pupil|eyelid|socket|眼球|眼白|瞳孔|眼眶|眼睑|mouth|oral|lip|lipline|teeth|tooth|tongue|口腔|嘴|嘴巴|口|牙|舌|hirco[_-]?col)/i.test(name);
            item.userData.outlineParameters = {
                visible: !excluded,
                thickness: this.outline.thickness,
                color: [0, 0, 0],
                alpha: this.outline.alpha,
                keepAlive: true,
            };
        });
    }

    dispose() {
        this.pause();
        const mixer = this.model ? this.ensureMixer() : null;
        this.clearFinishedHandler(mixer);
        this.hairCoverStage.dispose();
        this.gakumasTextures.forEach(entry => entry.texture?.dispose());
        this.gakumasTextures = [];
        Object.values(this.gakumasFallbacks).forEach(texture => texture.dispose());
        this.gakumasFallbacks = {};
        this.gakumasUniforms.clear();
        if (this.model && this.scene) {
            this.helper.remove(this.model);
            this.scene.remove(this.model);
        }
        this.disposeRenderer();
        this.model = null;
        this.ready = false;
        this.actions.clear();
        this.playlist = [];
        if (singleton === this) singleton = null;
    }
}















