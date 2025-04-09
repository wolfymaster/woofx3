import { c } from 'node_modules/vite/dist/node/moduleRunnerTransport.d-CXw_Ws6P';
import { useEffect, useRef, useState } from 'react';
import { id, i, init, InstaQLEntity } from "@instantdb/react";

const schema = i.schema({
    entities: {
        game: i.entity({
            row: i.number(),
            col: i.number(),
            xlength: i.number(),
            ylength: i.number(),
            color: i.string(),
            done: i.boolean(),
        }),
    },
});

const APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";

const db = init({ appId: APP_ID, schema });

export default function PixelArt() {
    const canvasRef = useRef<null | HTMLCanvasElement>(null);
    const { isLoading, error, data } = db.useQuery({
        game: {
            $: {
                where: {
                    done: false,
                }
            }
        }
    });
    const pixelSquareSize = 10;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;        
        data?.game.forEach((g) => {
            ctx.fillStyle = g.color;
            ctx.fillRect((g.row*pixelSquareSize),(g.col*pixelSquareSize), g.xlength * pixelSquareSize, g.ylength * pixelSquareSize);
        })
    }, [data]);

    if (isLoading) {
        return <></>;
    }

    return (
        <>
            <canvas ref={canvasRef} id="image" width="1080" height="720"></canvas>
        </>
    )
}