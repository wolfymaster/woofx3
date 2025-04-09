interface Point {
    x: number;
    y: number;
}

// export function parsePoints(input: string): Point[] {
//     const segments = input.trim().split(/(?<!,)\s+/);
//     const points: Point[] = [];

//     for (const segment of segments) {
//         if (segment.includes(',')) {
//             const [x, y] = segment.split(',').map(Number);
//             points.push({ x, y });
//         }
//     }

//     if (points.length === 0 && segments.length >= 2) {
//         for (let i = 0; i < segments.length; i += 2) {
//             if (i + 1 < segments.length) {
//                 points.push({
//                     x: Number(segments[i]),
//                     y: Number(segments[i + 1])
//                 });
//             }
//         }
//     }

//     if(points.length == 0) {
//         return [];
//     }

//     if (points.length === 1) {
//         return points;
//     }

//     const [p1, p2] = points;

//     if (p1.x === p2.x && p1.y === p2.y) {
//         points.pop();
//     } else if (p1.x !== p2.x && p1.y !== p2.y) {
//         return [];
//     }

//     return points;
// }

export function parsePoints(input: string): Point[] {
    const values = input.trim().replaceAll(',', '');

    const coords = values.split(' ');

    if(coords.length == 2) {
        return [
            { x: +coords[0], y: +coords[1] }
        ]
    }

    if(coords.length == 4) {
        const p1 =  { x: +coords[0], y: +coords[1] };
        const p2 = { x: +coords[2], y: +coords[3] };

        if (p1.x === p2.x && p1.y === p2.y) {
            return [p1];
        } else if (p1.x !== p2.x && p1.y !== p2.y) {
            return [];
        }
        return [p1, p2];
    }

    return [];
}