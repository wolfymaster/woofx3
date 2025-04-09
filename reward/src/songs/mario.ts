function generateStrings(template: string, count: number, padLength = 0) {
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

export default function* BitSong(template: string, numClips: number, padLength = 0) {
    let idx = 0;

    const clips = generateStrings(template, numClips, padLength);

    while(true) {
        yield {
            audioUrl: clips[idx],
        }

        idx = (idx + 1) % numClips;
    }
}