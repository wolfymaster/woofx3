import { SetAnimatedFilterOptions } from "./types";

function createValueGenerator(
    startValue: number,
    targetValue: number,
    frames: number,
    easingType = 'linear'
) {
    // Define easing functions
    const easingFunctions = {
        linear: t => t,
        easeIn: t => t * t,
        easeOut: t => t * (2 - t),
        easeInOut: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
        bounce: t => {
            const n1 = 7.5625;
            const d1 = 2.75;
            if (t < 1 / d1) return n1 * t * t;
            if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
            if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
            return n1 * (t -= 2.625 / d1) * t + 0.984375;
        },
        elastic: t => {
            return t === 0
                ? 0
                : t === 1
                    ? 1
                    : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3));
        }
    };

    // Select easing function
    const easing = easingFunctions[easingType] || easingFunctions.linear;

    // Calculate the value range
    const valueRange = targetValue - startValue;

    // Return a generator function
    let currentFrame = 0;

    return function () {
        if (currentFrame > frames) {
            return null; // Signal animation complete
        }

        // Calculate progress (0 to 1)
        const progress = currentFrame / frames;

        // Apply easing function
        const easedProgress = easing(progress);

        // Calculate the current value
        const currentValue = startValue + (valueRange * easedProgress);

        // Increment frame counter
        currentFrame++;

        return currentValue;
    };
}

export async function animate(
    updateFn: (value: number) => Promise<void>,
    startValue: number,
    targetValue: number,
    options?: SetAnimatedFilterOptions,
) {

    const { frameRate, durationMs, easingType } = Object.assign({ frameRate: 60, durationMs: 1000, easingType: 'linear' }, options);

    // Calculate frame information
    const frameMs = Math.max(16, 1000 / frameRate);
    const frames = Math.ceil(durationMs / frameMs);

    // Create value generator
    const getNextValue = createValueGenerator(startValue, targetValue, frames, easingType);

    // Run animation
    let value = getNextValue();
    while (value !== null) {
        try {
            await updateFn(value);
        } catch (error) {
            console.error('Error in animation update function:', error);
            break;
        }

        await new Promise(resolve => setTimeout(resolve, frameMs));
        value = getNextValue();
    }

    // Ensure we end on the exact target value
    if (value === null) {
        try {
            await updateFn(targetValue);
        } catch (error) {
            console.error('Error in final animation update:', error);
        }
    }
}