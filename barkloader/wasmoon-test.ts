import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { LuaFactory } from 'wasmoon';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

const factory = new LuaFactory();

const lua = await factory.createEngine();

try {
    // generic http request host function
    lua.global.set('httpRequest', async (url: string, method: string, opts: { body?: any, headers?: Record<string, string> } = {}) => {
        const response = await fetch(url, {
            method,
            headers: opts.headers || {},
            body: opts.body ? JSON.stringify(opts.body) : undefined
        });
        return response.json();
    });

    lua.global.set('environment', (value: string) => {
        return process.env[value];
    })
   
    console.time('timer')
       
    // Run the Lua code for Govee implementation
    const luaLightScript = fs.readFileSync('lua/test.lua', 'utf8');
    await lua.doString(luaLightScript);
    const main = lua.global.get('main');
    
    for(let i = 0; i < 1000; ++i) {        
        const value = await main(i);
        console.log(value);
    }
    console.timeEnd('timer');


} finally {
    // Close the lua environment
    lua.global.close()
}
