import { stageSnapshot, sceneIdolId, SCENE_IDOLS } from './scene-protocol.js';
import { StageAttentionController } from './stage-attention.js?v=20260914-stage-attention-v1';

export class SceneDirector {
    constructor(container, createRuntime) {
        this.container = container;
        this.createRuntime = createRuntime;
        this.entries = new Map();
        this.generation = 0;
        this.controller = new AbortController();
    }

    async preload(cast) {
        for (const idolId of cast) {
            if (this.controller.signal.aborted) return;
            if (!this.entries.has(idolId)) {
                const canvas = this.container.ownerDocument.createElement('canvas');
                canvas.hidden = true;
                canvas.dataset.idol = idolId;
                canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
                this.container.append(canvas);
                const entry = { canvas, player: this.createRuntime(canvas), present: false };
                this.entries.set(idolId, entry);
                entry.ready = entry.player.ensure(idolId).catch(error => {
                    console.warn('[SceneDirector] model unavailable', idolId, error);
                    return false;
                }).then(ready => {
                    if (this.controller.signal.aborted) { entry.player.dispose(); return false; }
                    return ready;
                });
            }
            await this.entries.get(idolId).ready;
        }
    }

    async sync(slides, index, { animate = true } = {}) {
        const generation = ++this.generation;
        this.transitionAbort?.abort();
        this.transitionAbort = new AbortController();
        const signal = this.transitionAbort.signal;
        const snapshot = stageSnapshot(slides, index);
        const current = slides[index];
        const isCurrent = () => generation === this.generation && !this.controller.signal.aborted;
        await this.preload(snapshot.cast);
        if (!isCurrent()) return false;
        await Promise.all([...this.entries].map(async ([idolId, entry]) => {
            const target = snapshot.actors[idolId];
            const position = target?.position || entry.position || 'center';
            entry.canvas.style.transform = `translateX(${position === 'left' ? -27 : position === 'right' ? 27 : 0}%)`;
            entry.position = position;
            if (target && !entry.present) {
                if (!await entry.ready || !isCurrent()) return;
                const animated = animate && current?.type === 'stage' && current.action === 'enter' && current.idolId === idolId;
                if (animated) {
                    await entry.player.playStageTransition('enter', { signal, isCurrent, onStart: () => {
                        entry.present = true;
                        entry.canvas.hidden = false;
                        entry.player.resume();
                    } });
                } else {
                    entry.present = true;
                    entry.canvas.hidden = false;
                    entry.player.resume();
                }
            } else if (!target && entry.present) {
                const animated = animate && current?.type === 'stage' && current.action === 'exit' && current.idolId === idolId;
                if (animated) await entry.player.playStageTransition('exit', { signal, isCurrent });
                if (!isCurrent()) return;
                entry.present = false;
                entry.canvas.hidden = true;
                entry.player.pause();
            }
        }));
        const present = Object.entries(snapshot.actors);
        const names = Object.fromEntries(Object.entries(SCENE_IDOLS).map(([name, id]) => [id, name]));
        const actionPromises = [];
        const currentSpeaker = sceneIdolId(current?.speaker);
        for (const [idolId, actor] of present) {
            const entry = this.entries.get(idolId);
            if (!entry) continue;
            if (!entry.player.setAttentionTarget) continue;
            let target = actor.look || null;
            if (target === 'auto') target = null;
            if (!target && currentSpeaker && currentSpeaker !== idolId && current?.type === 'dialogue') target = currentSpeaker;
            if (!target && present.length === 2 && (current?.type === 'narration' || current?.type === 'stage')) target = present.find(([other]) => other !== idolId)?.[0] || 'camera';
            if (!target && currentSpeaker === idolId && present.length === 2) target = present.find(([other]) => other !== idolId)?.[0] || 'camera';
            const vector = !target || target === 'camera' || target === 'none'
                ? { x: 0, y: 0 }
                : StageAttentionController.resolveTarget(idolId, target, Object.fromEntries(present.map(([id, value]) => [id, value.position])));
            entry.player.setAttentionTarget(target || 'camera', vector, actor.duration || 720);
            if (actor.action && entry.player.playSpeakerCue && names[idolId]) actionPromises.push(entry.player.playSpeakerCue(names[idolId] + '(' + actor.action + ')', { slideType: 'action', isCurrent }));
        }
        await Promise.all(actionPromises);
        return isCurrent();
    }

    async speak(speaker, slideType) {
        const entry = this.entries.get(sceneIdolId(speaker));
        if (!entry?.present) return false;
        const generation = this.generation;
        return entry.player.playSpeakerCue(speaker, { slideType,
            isCurrent: () => generation === this.generation && entry.present && !this.controller.signal.aborted });
    }

    pause() {
        this.generation++;
        this.transitionAbort?.abort();
        for (const entry of this.entries.values()) entry.player.pause();
    }

    resume() {
        for (const entry of this.entries.values()) if (entry.present) entry.player.resume();
    }

    dispose() {
        this.pause();
        this.controller.abort();
        for (const entry of this.entries.values()) { entry.player.dispose(); entry.canvas.remove(); }
        this.entries.clear();
    }
}

