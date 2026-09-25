export function identifyLibraryIdol(config, fileName) {
    const name = String(fileName || '').replaceAll('\\', '/').split('/').pop().toLowerCase();
    return (config?.idols || []).find(idol => {
        const model = idol.model.toLowerCase();
        return name === model || name === model.replace(/-vmd(?:-face)?\.pmx$/, '.pmx');
    }) || null;
}

export function supportsSecondaryMotion(idol) {
    return Boolean(idol && idol.secondaryMotionProfile !== false);
}

export function motionMatchesIdol(item, idolId) {
    const character = item.catalog?.character || item.character || '';
    return !idolId || !character || character === 'cmmn' || character === idolId;
}
