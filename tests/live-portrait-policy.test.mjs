import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    LIVE_PORTRAIT_IDOL_ID,
    canUseLivePortrait,
    isLivePortraitSpeaker,
    normalizeLivePortraitSpeaker,
    shouldPlayLivePortraitTalk,
    shouldShowLivePortrait,
} from '../live-portrait-policy.js';

const livePortraitSource = readFileSync(fileURLToPath(new URL('../live-portrait.js', import.meta.url)), 'utf8');

test('all exported dialogue-stage idols are live portrait speakers', () => {
    assert.equal(normalizeLivePortraitSpeaker('藤田琴音(平常待机)'), '藤田琴音');
    assert.equal(isLivePortraitSpeaker('藤田琴音'), true);
    assert.equal(isLivePortraitSpeaker('藤田琴音(生气抗议)'), true);
    assert.equal(isLivePortraitSpeaker('月村手毬'), true);
    assert.equal(LIVE_PORTRAIT_IDOL_ID, 'fktn');
});

test('library status gates whether the 3D portrait can be used', () => {
    assert.equal(canUseLivePortrait('藤田琴音', { packs: { 'idols/fktn': { available: true } } }), true);
    assert.equal(canUseLivePortrait('藤田琴音', { packs: { 'idols/fktn': { available: false } } }), false);
    assert.equal(canUseLivePortrait('藤田琴音', null), true);
    assert.equal(canUseLivePortrait('月村手毬', { packs: { 'idols/fktn': { available: true } } }), false);
});

test('live portrait stays on screen for Kotone produce, even during narration or other speakers', () => {
    const base = { idol: '藤田琴音', speaker: '藤田琴音', slideType: 'dialogue', available: true };
    assert.equal(shouldShowLivePortrait(base), true);
    assert.equal(shouldShowLivePortrait({ ...base, slideType: 'narration' }), true);
    assert.equal(shouldShowLivePortrait({ ...base, speaker: '花海咲季' }), true);
    assert.equal(shouldShowLivePortrait({ ...base, nsfw: true }), false);
    assert.equal(shouldShowLivePortrait({ ...base, hcg: true }), false);
    assert.equal(shouldShowLivePortrait({ ...base, available: false }), false);
    assert.equal(shouldShowLivePortrait({ idol: '花海咲季', speaker: '花海咲季', available: true }), true);
    assert.equal(shouldPlayLivePortraitTalk('藤田琴音', 'dialogue'), true);
    assert.equal(shouldPlayLivePortraitTalk('藤田琴音', 'narration'), false);
    assert.equal(shouldPlayLivePortraitTalk('月村手毬', 'dialogue'), true);
    assert.equal(shouldPlayLivePortraitTalk('制作人', 'dialogue'), false);
});

test('VN live portrait uses the Stage Gakumas shader path', () => {
    assert.match(livePortraitSource, /gakumas-shader\.js/);
    assert.match(livePortraitSource, /injectActorShader/);
    assert.match(livePortraitSource, /applyGakumasMaterials/);
    assert.match(livePortraitSource, /HairCoverStage/);
    assert.match(livePortraitSource, /HairShadowStage/);
    assert.match(livePortraitSource, /waitForModelTextures/);
    assert.match(livePortraitSource, /loadGakumasTextures/);
    assert.match(livePortraitSource, /waitForModelTextures/);
    assert.match(livePortraitSource, /loadGakumasTextures/);
    assert.match(livePortraitSource, /hairCoverStage\.renderFrame/);
    assert.match(livePortraitSource, /gakumas-look\.js/);
    assert.match(livePortraitSource, /GakumasLookPass/);
    assert.match(livePortraitSource, /characterShadow: true/);
    assert.match(livePortraitSource, /const loop = false/);
    assert.match(livePortraitSource, /mixer\.timeScale = 0/);
    assert.match(livePortraitSource, /LoopOnce/);
    assert.doesNotMatch(livePortraitSource, /shouldLoopMotion\(item, true\)/);
    assert.doesNotMatch(livePortraitSource, /preferPhase: 'lp'/);
    assert.doesNotMatch(livePortraitSource, /shouldReturnToIdle\(item\)/);
});
