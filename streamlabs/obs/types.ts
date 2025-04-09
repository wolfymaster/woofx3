export interface Context {
    logger: (msg: string) => void
}

export interface SetAnimatedFilterOptions {
    durationMs?: number,
    easingType?: string,
    frameRate?: number,
}; 