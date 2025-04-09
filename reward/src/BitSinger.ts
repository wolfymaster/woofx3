export default class BitSinger {
    private templates: Template[];
    private playRandom: boolean;
    private currentPlayerIdx: number;
    private currentGenerator: Generator<{ audioUrl: string }, void, unknown> | null;

    constructor(args: BitSingerArgs) {
        this.templates = args.templates;
        this.playRandom = args?.random ?? false;
        this.currentPlayerIdx = this.playRandom ? Math.random() * this.templates.length : 0;
        this.currentGenerator = null;
    }

    play(): { audioUrl: string } {
        if(!this.currentGenerator) {
            const template = this.templates[this.currentPlayerIdx]; 
            const clips = this.generateStrings(template.pattern, template.numClips, template.padding);   
            this.currentGenerator = this._play(clips);
        }

        const generator = this.currentGenerator.next();

        if(generator.done) {
            this.currentPlayerIdx = this.playRandom ? Math.random() * this.templates.length : (this.currentPlayerIdx + 1) % this.templates.length;
            this.currentGenerator = null;
            return this.play()
        }
        return generator.value;
    }

    *_play(clips: string[]): Generator<{ audioUrl: string }, void, unknown> {  
        for(let i = 0; i < clips.length; ++i) {
            yield {
                audioUrl: clips[i],
            }
        }
    }

    private generateStrings(template: string, count: number, padLength = 0) {
        const result = [];

        // Find where to insert the number in the template
        const placeholder = template.indexOf('{n}') !== -1 ? '{n}' :
            template.indexOf('{i}') !== -1 ? '{i}' :
                '_';

        for (let i = 0; i < count; i++) {
            // Format the number with padding if needed
            const formattedNumber = padLength > 0 ?
                i.toString().padStart(padLength, '0') :
                i.toString();

            // Replace the placeholder with the current formatted iteration number
            if (placeholder === '_') {
                // If no explicit placeholder, replace the last underscore before file extension
                const parts = template.split('_');
                const lastPart = parts.pop();
                result.push([...parts, formattedNumber, lastPart].join('_'));
            } else {
                // Replace the explicit placeholder
                result.push(template.replace(placeholder, formattedNumber));
            }
        }

        return result;
    }
}

export type BitSingerArgs = {
    templates: Template[],
    random?: boolean,
}

export type Template = {
    pattern: string;
    numClips: number;
    padding: number;
}