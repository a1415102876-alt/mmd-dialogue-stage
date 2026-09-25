export function classifyActorPass(materialName, textureName) {
    const value = `${materialName || ''} ${textureName || ''}`.toLowerCase();
    if (/hir\+|_sph(?:\.|_|$)/.test(value)) return 'hairHighlight';
    if (/ehl|eye|eyeball|iris|pupil|眼|瞳/.test(value)) return 'eye';
    if (/ebs|brow|eyebrow|fce_lyr|face.?detail|眉/.test(value)) return 'faceDetail';
    if (/hir|hair|髪|头发|发/.test(value)) return 'hair';
    if (/mouth|oral|teeth|tooth|tongue|inner|inside|口腔|牙|舌/.test(value)) return 'internal';
    if (/cloth|dress|skirt|shirt|sleeve|jacket|衣|服|裙|袖|外套/.test(value)) return 'clothing';
    if (/bdy|body|身体/.test(value)) return 'body';
    if (/fce|face|head|脸|面部/.test(value)) return 'face';
    return 'body';
}

export function shouldCastCharacterShadow(role) {
    // Hair cards are thin sheets, not a volume. In Three.js they stamp a
    // silhouette into the shadow map, which looks like the hair mesh projected
    // onto the body rather than a light shadow. Body is the same PMX material
    // as inner arms. Only separately authored clothing may cast.
    return role === 'clothing';
}

export function shouldReceiveCharacterShadow(role) {
    // The sample turns off head casting; back/side hair still lands on the
    // face if the face samples the same map. Face lighting stays on Ramp/Def.
    return ['body', 'clothing'].includes(role);
}

export function shouldWriteHairShadow(role) {
    // Only the hair cards themselves. Highlights are a thin overlay and must
    // not stamp a second silhouette into the screen-space buffer.
    return role === 'hair';
}

export function shouldReceiveHairShadow(role) {
    // Yu-ki's later UE pass: ToonFace / ToonEye only. Body stays on Ramp.
    return ['face', 'faceDetail', 'eye'].includes(role);
}

export function isHairCoverSourceMaterial(materialName, textureName) {
    const material = `${materialName || ''}`.toLowerCase().trim();
    const texture = `${textureName || ''}`.toLowerCase();
    const isHairTexture = /(?:^|[_-])hir_col_alp(?:\.|_|$)/.test(texture);
    if (material) return material === 'm_hir' && isHairTexture;
    return isHairTexture;
}

export function actorStencilState(materialName, actorPass) {
    const name = `${materialName || ''}`.toLowerCase();
    if (actorPass === 'eye' || actorPass === 'eyeHighlight') return { write: true, func: 'EqualStencilFunc', ref: 68, readMask: 108, writeMask: 108, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'KeepStencilOp' };
    if (name.includes('ebs')) return { write: true, func: 'AlwaysStencilFunc', ref: 68, readMask: 108, writeMask: 108, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'ReplaceStencilOp' };
    if (name.includes('fcp')) return { write: true, func: 'AlwaysStencilFunc', ref: 72, readMask: 108, writeMask: 108, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'ReplaceStencilOp' };
    if (actorPass === 'face' || actorPass === 'faceDetail') return { write: true, func: 'AlwaysStencilFunc', ref: 64, readMask: 108, writeMask: 108, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'ReplaceStencilOp' };
    if (actorPass === 'hair') return { write: true, func: 'GreaterEqualStencilFunc', ref: 64, readMask: 108, writeMask: 96, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'ReplaceStencilOp' };
    return { write: false, func: 'AlwaysStencilFunc', ref: 0, readMask: 0xff, writeMask: 0, fail: 'KeepStencilOp', zFail: 'KeepStencilOp', zPass: 'KeepStencilOp' };
}
